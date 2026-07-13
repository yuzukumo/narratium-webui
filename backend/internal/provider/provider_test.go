package provider

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

type capturedRequest struct {
	path    string
	rawPath string
	query   string
	header  http.Header
	body    []byte
}

func captureRequest(t *testing.T, request *http.Request) capturedRequest {
	t.Helper()
	body, err := io.ReadAll(request.Body)
	if err != nil {
		t.Errorf("read request body: %v", err)
	}
	return capturedRequest{
		path:    request.URL.Path,
		rawPath: request.URL.RawPath,
		query:   request.URL.RawQuery,
		header:  request.Header.Clone(),
		body:    body,
	}
}

func decodeObject(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("decode JSON object: %v\nbody: %s", err, body)
	}
	return result
}

func objectValue(t *testing.T, value any) map[string]any {
	t.Helper()
	switch object := value.(type) {
	case map[string]any:
		return object
	case map[string]string:
		result := make(map[string]any, len(object))
		for key, item := range object {
			result[key] = item
		}
		return result
	default:
		t.Fatalf("value has type %T, want object", value)
		return nil
	}
}

func arrayValue(t *testing.T, value any) []any {
	t.Helper()
	switch array := value.(type) {
	case []any:
		return array
	case []map[string]any:
		result := make([]any, len(array))
		for index := range array {
			result[index] = array[index]
		}
		return result
	default:
		t.Fatalf("value has type %T, want array", value)
		return nil
	}
}

func float64Pointer(value float64) *float64 { return &value }

func collectEvents(t *testing.T, events <-chan Event) []Event {
	t.Helper()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	var collected []Event
	for {
		select {
		case event, ok := <-events:
			if !ok {
				return collected
			}
			collected = append(collected, event)
		case <-timer.C:
			t.Fatal("timed out waiting for provider stream")
		}
	}
}

func writeFragmented(t *testing.T, writer http.ResponseWriter, payload string) {
	t.Helper()
	flusher, ok := writer.(http.Flusher)
	if !ok {
		t.Fatal("httptest response writer does not implement http.Flusher")
	}
	for index := range len(payload) {
		if _, err := writer.Write([]byte{payload[index]}); err != nil {
			return
		}
		flusher.Flush()
	}
}
