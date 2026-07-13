package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/yuzukumo/narratium-webui/backend/internal/config"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
)

type blobHandlerRepository struct {
	*testRepository
	page           domain.Page[domain.UserBlob]
	listLimit      int
	listOffset     int
	putErr         error
	putRevision    int64
	putQuota       store.BlobQuota
	deleteErr      error
	deleteRevision int64
	putResponse    domain.UserBlob
}

func newBlobHandlerRepository() *blobHandlerRepository {
	return &blobHandlerRepository{testRepository: newTestRepository()}
}

func (r *blobHandlerRepository) ListBlobs(_ context.Context, _ string, limit, offset int) (domain.Page[domain.UserBlob], error) {
	r.listLimit = limit
	r.listOffset = offset
	return r.page, nil
}

func (r *blobHandlerRepository) PutBlob(
	_ context.Context,
	_, _, _ string,
	_ []byte,
	expectedRevision int64,
	quota store.BlobQuota,
) (domain.UserBlob, error) {
	r.putRevision = expectedRevision
	r.putQuota = quota
	if r.putErr != nil {
		return domain.UserBlob{}, r.putErr
	}
	if r.putResponse.Key == "" {
		return domain.UserBlob{
			Key: "image.png", ContentType: "image/png", Size: 4, Revision: expectedRevision + 1,
			UpdatedAt: time.Unix(1, 0).UTC(),
		}, nil
	}
	return r.putResponse, nil
}

func (r *blobHandlerRepository) DeleteBlob(_ context.Context, _, _ string, expectedRevision int64) error {
	r.deleteRevision = expectedRevision
	return r.deleteErr
}

func newBlobHandlerTestServer(t *testing.T, repository *blobHandlerRepository) (testServer, domain.User) {
	t.Helper()
	user := domain.User{
		ID: "blob-user", Name: "blob-user", Role: domain.RoleUser,
		Status: domain.StatusActive, TokenVersion: 1,
	}
	repository.users[user.ID] = user
	server := newHTTPTestServer(t, repository, func(cfg *config.Config) {
		cfg.MaxBlobsPerUser = 7
		cfg.MaxBlobTotalBytes = 1234
	})
	return server, user
}

func performBlobRequest(
	t *testing.T,
	server testServer,
	user domain.User,
	method, path, ifMatch string,
) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, bytes.NewBufferString("data"))
	request.AddCookie(server.cookie(t, user))
	request.Header.Set("Content-Type", "image/png")
	if ifMatch != "" {
		request.Header.Set("If-Match", ifMatch)
	}
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	return response
}

func TestListBlobsReturnsPaginationAndByteSize(t *testing.T) {
	repository := newBlobHandlerRepository()
	repository.page = domain.Page[domain.UserBlob]{
		Total: 3,
		Items: []domain.UserBlob{{
			Key: "second.png", ContentType: "image/png", Size: 42, Revision: 5,
			UpdatedAt: time.Unix(2, 0).UTC(),
		}},
	}
	server, user := newBlobHandlerTestServer(t, repository)
	response := performBlobRequest(t, server, user, http.MethodGet, "/api/v1/blobs?limit=1&offset=1", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if repository.listLimit != 1 || repository.listOffset != 1 {
		t.Fatalf("repository pagination=(%d,%d), want (1,1)", repository.listLimit, repository.listOffset)
	}
	var payload struct {
		Items  []domain.UserBlob `json:"items"`
		Total  int               `json:"total"`
		Limit  int               `json:"limit"`
		Offset int               `json:"offset"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode blob list: %v", err)
	}
	if payload.Total != 3 || payload.Limit != 1 || payload.Offset != 1 || len(payload.Items) != 1 || payload.Items[0].Size != 42 {
		t.Fatalf("blob list payload = %+v", payload)
	}
}

func TestBlobChangesRequireStrictIntegerETag(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		ifMatch    string
		wantStatus int
		wantCode   string
	}{
		{name: "missing", method: http.MethodPut, wantStatus: http.StatusPreconditionRequired, wantCode: "precondition_required"},
		{name: "unquoted", method: http.MethodPut, ifMatch: "0", wantStatus: http.StatusBadRequest, wantCode: "invalid_revision"},
		{name: "weak", method: http.MethodPut, ifMatch: `W/"0"`, wantStatus: http.StatusBadRequest, wantCode: "invalid_revision"},
		{name: "negative", method: http.MethodPut, ifMatch: `"-1"`, wantStatus: http.StatusBadRequest, wantCode: "invalid_revision"},
		{name: "noncanonical", method: http.MethodPut, ifMatch: `"01"`, wantStatus: http.StatusBadRequest, wantCode: "invalid_revision"},
		{name: "delete create revision", method: http.MethodDelete, ifMatch: `"0"`, wantStatus: http.StatusBadRequest, wantCode: "invalid_revision"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repository := newBlobHandlerRepository()
			server, user := newBlobHandlerTestServer(t, repository)
			response := performBlobRequest(t, server, user, tt.method, "/api/v1/blobs/image.png", tt.ifMatch)
			if response.Code != tt.wantStatus || !strings.Contains(response.Body.String(), `"code":"`+tt.wantCode+`"`) {
				t.Fatalf("status=%d body=%s, want status=%d code=%q", response.Code, response.Body.String(), tt.wantStatus, tt.wantCode)
			}
		})
	}
}

func TestPutBlobPassesRevisionAndQuota(t *testing.T) {
	repository := newBlobHandlerRepository()
	server, user := newBlobHandlerTestServer(t, repository)
	response := performBlobRequest(t, server, user, http.MethodPut, "/api/v1/blobs/image.png", `"0"`)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if repository.putRevision != 0 {
		t.Fatalf("expected revision=%d, want 0", repository.putRevision)
	}
	if repository.putQuota != (store.BlobQuota{MaxCount: 7, MaxTotalBytes: 1234}) {
		t.Fatalf("blob quota=%+v", repository.putQuota)
	}
	if response.Header().Get("ETag") != `"1"` {
		t.Fatalf("ETag=%q, want %q", response.Header().Get("ETag"), `"1"`)
	}
}

func TestBlobStoreErrorsHaveStableHTTPMappings(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		storeError error
		wantStatus int
		wantCode   string
	}{
		{name: "stale put", method: http.MethodPut, storeError: store.ErrConflict, wantStatus: http.StatusConflict, wantCode: "revision_conflict"},
		{name: "count quota", method: http.MethodPut, storeError: store.ErrBlobCountQuota, wantStatus: http.StatusConflict, wantCode: "blob_count_quota_exceeded"},
		{name: "byte quota", method: http.MethodPut, storeError: store.ErrBlobTotalBytesQuota, wantStatus: http.StatusRequestEntityTooLarge, wantCode: "blob_storage_quota_exceeded"},
		{name: "stale delete", method: http.MethodDelete, storeError: store.ErrConflict, wantStatus: http.StatusConflict, wantCode: "revision_conflict"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repository := newBlobHandlerRepository()
			if tt.method == http.MethodDelete {
				repository.deleteErr = tt.storeError
			} else {
				repository.putErr = tt.storeError
			}
			server, user := newBlobHandlerTestServer(t, repository)
			response := performBlobRequest(t, server, user, tt.method, "/api/v1/blobs/image.png", `"1"`)
			if response.Code != tt.wantStatus || !strings.Contains(response.Body.String(), `"code":"`+tt.wantCode+`"`) {
				t.Fatalf("status=%d body=%s, want status=%d code=%q", response.Code, response.Body.String(), tt.wantStatus, tt.wantCode)
			}
		})
	}
}

func TestDeleteBlobPassesPositiveRevision(t *testing.T) {
	repository := newBlobHandlerRepository()
	server, user := newBlobHandlerTestServer(t, repository)
	response := performBlobRequest(t, server, user, http.MethodDelete, "/api/v1/blobs/image.png", `"7"`)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if repository.deleteRevision != 7 {
		t.Fatalf("delete revision=%d, want 7", repository.deleteRevision)
	}
}
