package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/yuzukumo/narratium-webui/backend/internal/domain"
	"github.com/yuzukumo/narratium-webui/backend/internal/store"
)

func (a *API) getDocument(c *gin.Context) {
	namespace := c.Param("namespace")
	if !domain.AllowedDocumentNamespaces[namespace] {
		writeError(c, http.StatusNotFound, "namespace_not_found", "Data namespace not found.")
		return
	}
	item, err := a.repo.GetDocument(c.Request.Context(), currentUser(c).ID, namespace)
	if errors.Is(err, store.ErrNotFound) {
		initial := json.RawMessage(`[]`)
		if namespace == "preferences" {
			initial = json.RawMessage(`{}`)
		}
		c.JSON(http.StatusOK, domain.UserDocument{Namespace: namespace, Value: initial, Revision: 0})
		return
	}
	if err != nil {
		a.internalError(c, "get user document", err)
		return
	}
	c.Header("ETag", fmt.Sprintf(`"%d"`, item.Revision))
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, item)
}

type putDocumentRequest struct {
	Value            json.RawMessage `json:"value"`
	ExpectedRevision *int64          `json:"expected_revision,omitempty"`
}

func (a *API) putDocument(c *gin.Context) {
	namespace := c.Param("namespace")
	if !domain.AllowedDocumentNamespaces[namespace] {
		writeError(c, http.StatusNotFound, "namespace_not_found", "Data namespace not found.")
		return
	}
	var request putDocumentRequest
	if err := decodeJSON(c, &request); err != nil {
		writeDecodeError(c, err, "value must contain valid JSON.")
		return
	}
	if len(request.Value) == 0 || !json.Valid(request.Value) {
		writeError(c, http.StatusBadRequest, "invalid_request", "value must contain valid JSON.")
		return
	}
	if request.ExpectedRevision != nil && *request.ExpectedRevision < 0 {
		writeError(c, http.StatusBadRequest, "invalid_revision", "expected_revision cannot be negative.")
		return
	}
	item, err := a.repo.PutDocument(c.Request.Context(), currentUser(c).ID, namespace, request.Value, request.ExpectedRevision)
	if errors.Is(err, store.ErrConflict) {
		writeError(c, http.StatusConflict, "revision_conflict", "The data changed on another client. Reload before saving.")
		return
	}
	if err != nil {
		a.internalError(c, "put user document", err)
		return
	}
	c.Header("ETag", fmt.Sprintf(`"%d"`, item.Revision))
	c.JSON(http.StatusOK, item)
}

func (a *API) getBlob(c *gin.Context) {
	key, ok := blobKey(c)
	if !ok {
		return
	}
	item, err := a.repo.GetBlob(c.Request.Context(), currentUser(c).ID, key)
	if errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusNotFound, "blob_not_found", "Blob not found.")
		return
	}
	if err != nil {
		a.internalError(c, "get user blob", err)
		return
	}
	c.Header("ETag", fmt.Sprintf(`"%d"`, item.Revision))
	c.Header("Cache-Control", "private, no-store")
	c.Data(http.StatusOK, item.ContentType, item.Data)
}

func (a *API) listBlobs(c *gin.Context) {
	limit, offset := parsePagination(c)
	page, err := a.repo.ListBlobs(c.Request.Context(), currentUser(c).ID, limit, offset)
	if err != nil {
		a.internalError(c, "list user blobs", err)
		return
	}
	metadata := make([]gin.H, 0, len(page.Items))
	for _, item := range page.Items {
		metadata = append(metadata, gin.H{
			"key": item.Key, "content_type": item.ContentType,
			"size": item.Size, "revision": item.Revision, "updated_at": item.UpdatedAt,
		})
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{
		"items": metadata, "total": page.Total, "limit": limit, "offset": offset,
	})
}

func (a *API) putBlob(c *gin.Context) {
	key, ok := blobKey(c)
	if !ok {
		return
	}
	expectedRevision, ok := requireBlobRevision(c)
	if !ok {
		return
	}
	contentType := strings.TrimSpace(c.GetHeader("Content-Type"))
	if contentType == "" || len(contentType) > 200 {
		writeError(c, http.StatusBadRequest, "invalid_content_type", "A valid Content-Type is required.")
		return
	}
	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(c, http.StatusRequestEntityTooLarge, "blob_too_large", "The blob exceeds the configured size limit.")
		} else {
			writeError(c, http.StatusBadRequest, "invalid_blob", "Unable to read the blob.")
		}
		return
	}
	if len(data) == 0 {
		writeError(c, http.StatusBadRequest, "empty_blob", "The blob cannot be empty.")
		return
	}
	item, err := a.repo.PutBlob(
		c.Request.Context(),
		currentUser(c).ID,
		key,
		contentType,
		data,
		expectedRevision,
		store.BlobQuota{MaxCount: a.cfg.MaxBlobsPerUser, MaxTotalBytes: a.cfg.MaxBlobTotalBytes},
	)
	switch {
	case errors.Is(err, store.ErrConflict):
		writeError(c, http.StatusConflict, "revision_conflict", "The blob changed on another client. Reload before saving.")
		return
	case errors.Is(err, store.ErrBlobCountQuota):
		writeError(c, http.StatusConflict, "blob_count_quota_exceeded", "The account has reached its blob count limit.")
		return
	case errors.Is(err, store.ErrBlobTotalBytesQuota):
		writeError(c, http.StatusRequestEntityTooLarge, "blob_storage_quota_exceeded", "The account has reached its total blob storage limit.")
		return
	case err != nil:
		a.internalError(c, "put user blob", err)
		return
	}
	c.Header("ETag", fmt.Sprintf(`"%d"`, item.Revision))
	c.JSON(http.StatusOK, gin.H{
		"key": item.Key, "content_type": item.ContentType, "size": item.Size,
		"revision": item.Revision, "updated_at": item.UpdatedAt,
	})
}

func (a *API) deleteBlob(c *gin.Context) {
	key, ok := blobKey(c)
	if !ok {
		return
	}
	expectedRevision, ok := requireBlobRevision(c)
	if !ok {
		return
	}
	if expectedRevision == 0 {
		writeError(c, http.StatusBadRequest, "invalid_revision", "If-Match must contain a positive revision when deleting a blob.")
		return
	}
	err := a.repo.DeleteBlob(c.Request.Context(), currentUser(c).ID, key, expectedRevision)
	if errors.Is(err, store.ErrConflict) || errors.Is(err, store.ErrNotFound) {
		writeError(c, http.StatusConflict, "revision_conflict", "The blob changed on another client. Reload before deleting.")
		return
	}
	if err != nil {
		a.internalError(c, "delete user blob", err)
		return
	}
	c.Status(http.StatusNoContent)
}

func blobKey(c *gin.Context) (string, bool) {
	raw := strings.TrimPrefix(c.Param("key"), "/")
	key, err := url.PathUnescape(raw)
	if err != nil || key == "" || len(key) > 500 || strings.ContainsRune(key, '\x00') {
		writeError(c, http.StatusBadRequest, "invalid_blob_key", "Blob key is invalid.")
		return "", false
	}
	return key, true
}

func requireBlobRevision(c *gin.Context) (int64, bool) {
	values := c.Request.Header.Values("If-Match")
	if len(values) == 0 || strings.TrimSpace(values[0]) == "" {
		writeError(c, http.StatusPreconditionRequired, "precondition_required", "If-Match is required for blob changes.")
		return 0, false
	}
	if len(values) != 1 {
		writeError(c, http.StatusBadRequest, "invalid_revision", "If-Match must be a single quoted integer ETag.")
		return 0, false
	}
	value := strings.TrimSpace(values[0])
	if len(value) < 3 || value[0] != '"' || value[len(value)-1] != '"' {
		writeError(c, http.StatusBadRequest, "invalid_revision", "If-Match must be a single quoted integer ETag.")
		return 0, false
	}
	rawRevision := value[1 : len(value)-1]
	revision, err := strconv.ParseInt(rawRevision, 10, 64)
	if err != nil || revision < 0 || strconv.FormatInt(revision, 10) != rawRevision {
		writeError(c, http.StatusBadRequest, "invalid_revision", "If-Match must be a non-negative integer ETag.")
		return 0, false
	}
	return revision, true
}
