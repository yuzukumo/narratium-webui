package provider

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// UpstreamError is returned for non-2xx responses and error events delivered
// inside otherwise successful streaming responses.
type UpstreamError struct {
	Provider   Kind            `json:"provider"`
	StatusCode int             `json:"status_code"`
	Type       string          `json:"type,omitempty"`
	Code       string          `json:"code,omitempty"`
	Message    string          `json:"message"`
	RequestID  string          `json:"request_id,omitempty"`
	RetryAfter string          `json:"retry_after,omitempty"`
	Body       json.RawMessage `json:"-"`
	Usage      Usage           `json:"-"`
}

func (err *UpstreamError) Error() string {
	if err == nil {
		return "<nil>"
	}
	label := string(err.Provider) + " upstream error"
	if err.StatusCode >= 300 {
		label += " (HTTP " + strconv.Itoa(err.StatusCode) + ")"
	} else if err.Code != "" {
		label += " (" + err.Code + ")"
	} else if err.Type != "" && err.Type != "error" {
		label += " (" + err.Type + ")"
	}
	if err.Message == "" {
		return label
	}
	return label + ": " + err.Message
}

func (err *UpstreamError) Temporary() bool {
	if err == nil {
		return false
	}
	return err.StatusCode == http.StatusRequestTimeout ||
		err.StatusCode == http.StatusTooManyRequests ||
		err.StatusCode >= http.StatusInternalServerError
}

func parseUpstreamError(kind Kind, status int, headers http.Header, body []byte, fallback string) *UpstreamError {
	errType, code, message := extractErrorFields(body)
	if message == "" {
		message = strings.TrimSpace(string(body))
	}
	if message == "" {
		if fallback != "" {
			message = fallback
		} else if status > 0 {
			message = fmt.Sprintf("request failed with status %d", status)
		} else {
			message = "upstream request failed"
		}
	}
	return &UpstreamError{
		Provider:   kind,
		StatusCode: status,
		Type:       errType,
		Code:       code,
		Message:    message,
		RequestID:  requestIDFromHeaders(headers),
		RetryAfter: headers.Get("Retry-After"),
		Body:       append(json.RawMessage(nil), body...),
	}
}

func extractErrorFields(body []byte) (errType, code, message string) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var value any
	if decoder.Decode(&value) != nil {
		return "", "", ""
	}
	return errorFieldsFromValue(value, 0)
}

func errorFieldsFromValue(value any, depth int) (errType, code, message string) {
	if depth > 6 {
		return "", "", ""
	}
	switch typed := value.(type) {
	case string:
		return "", "", strings.TrimSpace(typed)
	case map[string]any:
		for _, key := range []string{"error", "response"} {
			if nested, exists := typed[key]; exists && nested != nil {
				nestedType, nestedCode, nestedMessage := errorFieldsFromValue(nested, depth+1)
				if nestedMessage != "" || nestedCode != "" || nestedType != "" {
					return nestedType, nestedCode, nestedMessage
				}
			}
		}
		errType = stringValue(typed["type"])
		if errType == "" || errType == "error" {
			if status := stringValue(typed["status"]); status != "" {
				errType = status
			}
		}
		code = stringValue(typed["code"])
		message = stringValue(typed["message"])
		if message == "" {
			message = stringValue(typed["detail"])
		}
		return errType, code, message
	default:
		return "", "", ""
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}

func requestIDFromHeaders(headers http.Header) string {
	for _, name := range []string{"x-request-id", "request-id", "x-goog-request-id"} {
		if value := strings.TrimSpace(headers.Get(name)); value != "" {
			return value
		}
	}
	return ""
}
