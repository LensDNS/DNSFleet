package adguard

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// doJSON executes a request and decodes a 2xx JSON body into out when out is non-nil.
// It always drains and closes resp.Body. Network errors from do are returned as-is (wrapped by do).
func (c *Client) doJSON(ctx context.Context, method string, reqBody io.Reader, contentType string, out any, controlSegments ...string) error {
	resp, err := c.do(ctx, method, reqBody, contentType, controlSegments...)
	if err != nil {
		return err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return httpStatusToErr(resp.StatusCode)
	}

	if out != nil {
		dec := json.NewDecoder(resp.Body)
		if err := dec.Decode(out); err != nil {
			return &ErrJSONDecode{Err: err}
		}
	}
	return nil
}

func httpStatusToErr(code int) error {
	switch code {
	case http.StatusUnauthorized:
		return ErrHTTPUnauthorized
	case http.StatusForbidden:
		return ErrHTTPForbidden
	default:
		return &HTTPStatusError{StatusCode: code}
	}
}

func (c *Client) postJSON(ctx context.Context, body any, controlSegments ...string) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("adguard: marshal JSON: %w", err)
	}
	return c.doJSON(ctx, http.MethodPost, bytes.NewReader(raw), "application/json", nil, controlSegments...)
}

func (c *Client) putJSON(ctx context.Context, body any, controlSegments ...string) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("adguard: marshal JSON: %w", err)
	}
	return c.doJSON(ctx, http.MethodPut, bytes.NewReader(raw), "application/json", nil, controlSegments...)
}

// IsHTTPUnauthorized reports whether err is or wraps ErrHTTPUnauthorized.
func IsHTTPUnauthorized(err error) bool {
	return errors.Is(err, ErrHTTPUnauthorized)
}

// IsHTTPForbidden reports whether err is or wraps ErrHTTPForbidden.
func IsHTTPForbidden(err error) bool {
	return errors.Is(err, ErrHTTPForbidden)
}

// IsJSONDecodeError reports whether err is or wraps *ErrJSONDecode.
func IsJSONDecodeError(err error) bool {
	var jd *ErrJSONDecode
	return errors.As(err, &jd)
}

// HTTPStatusCode returns the HTTP status for *HTTPStatusError, or 0 if err does not wrap it.
func HTTPStatusCode(err error) int {
	var hs *HTTPStatusError
	if errors.As(err, &hs) {
		return hs.StatusCode
	}
	return 0
}
