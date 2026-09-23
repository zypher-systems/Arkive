package handlers_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// TestConcurrentUploadsAndReads hammers one workspace with parallel uploads,
// overwrites, listings, searches and downloads. On SQLite this proves the
// single-writer setup (WAL + BEGIN IMMEDIATE + busy_timeout) queues writers
// instead of failing with SQLITE_BUSY ("database is locked").
func TestConcurrentUploadsAndReads(t *testing.T) {
	env := newTestEnv(t)
	const writers, perWriter, readers = 16, 20, 6

	send := func(method, path string, body []byte) (int, string) {
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "text/plain")
		req.AddCookie(env.Cookie)
		rr := httptest.NewRecorder()
		env.H.ServeHTTP(rr, req)
		return rr.Code, rr.Body.String()
	}
	ws := env.WS.String()
	seed := env.upload("seed.txt", []byte("seed"))

	var wg sync.WaitGroup
	errs := make(chan error, writers*perWriter*2+readers*100)
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < perWriter; i++ {
				name := fmt.Sprintf("w%d-%d.txt", w, i)
				if code, body := send(http.MethodPut, "/api/workspaces/"+ws+"/upload?name="+name, []byte("payload "+name)); code != http.StatusCreated && code != http.StatusOK {
					errs <- fmt.Errorf("upload %s: %d %s", name, code, body)
				}
				// Overwrite a shared file too (new version, same row).
				if code, body := send(http.MethodPut, "/api/workspaces/"+ws+"/upload?name=shared.txt", []byte(name)); code != http.StatusCreated && code != http.StatusOK {
					errs <- fmt.Errorf("overwrite shared.txt: %d %s", code, body)
				}
			}
		}(w)
	}
	stop := make(chan struct{})
	var rwg sync.WaitGroup
	for r := 0; r < readers; r++ {
		rwg.Add(1)
		go func() {
			defer rwg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				for _, p := range []string{
					"/api/workspaces/" + ws + "/nodes",
					"/api/workspaces/" + ws + "/search?q=payload",
					"/api/nodes/" + seed.String() + "/download",
				} {
					if code, body := send(http.MethodGet, p, nil); code != http.StatusOK {
						errs <- fmt.Errorf("GET %s: %d %s", p, code, body)
					}
				}
			}
		}()
	}
	wg.Wait()
	close(stop)
	rwg.Wait()
	close(errs)
	n := 0
	for err := range errs {
		if n < 10 {
			t.Error(err)
		}
		n++
	}
	if n > 0 {
		t.Fatalf("%d concurrent requests failed", n)
	}

	var files int
	if err := env.App.DB.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM nodes WHERE workspace_id = $1 AND kind = 'file' AND deleted_at IS NULL
	`, env.WS).Scan(&files); err != nil {
		t.Fatal(err)
	}
	if want := writers*perWriter + 2; files != want {
		t.Fatalf("files=%d want %d", files, want)
	}
}
