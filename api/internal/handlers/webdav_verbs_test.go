package handlers_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebDAVPutAndPropfind(t *testing.T) {
	env := newTestEnv(t)
	path := "/dav/" + env.WS.String() + "/dav.txt"

	put := httptest.NewRequest(http.MethodPut, path, bytes.NewReader([]byte("hello dav")))
	put.Header.Set("Content-Type", "text/plain")
	put.SetBasicAuth(env.Email, env.Password)
	putRR := httptest.NewRecorder()
	env.H.ServeHTTP(putRR, put)
	if putRR.Code != http.StatusCreated && putRR.Code != http.StatusNoContent {
		t.Fatalf("PUT status=%d body=%s", putRR.Code, putRR.Body.String())
	}

	prop := httptest.NewRequest("PROPFIND", "/dav/"+env.WS.String()+"/", nil)
	prop.Header.Set("Depth", "1")
	prop.SetBasicAuth(env.Email, env.Password)
	propRR := httptest.NewRecorder()
	env.H.ServeHTTP(propRR, prop)
	if propRR.Code != http.StatusMultiStatus {
		t.Fatalf("PROPFIND status=%d body=%s", propRR.Code, propRR.Body.String())
	}
	body := propRR.Body.String()
	if !strings.Contains(body, "dav.txt") {
		t.Fatalf("PROPFIND missing dav.txt: %s", body)
	}
	if !strings.Contains(body, "multistatus") {
		t.Fatalf("PROPFIND missing multistatus: %s", body)
	}
}
