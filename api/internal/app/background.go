package app

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	bgWorkers    = 4
	bgQueueSize  = 512
	bgJobTimeout = 5 * time.Minute
)

type bgJob struct {
	name string
	fn   func(ctx context.Context) error
	args []any
}

// bgPool is a small bounded worker pool for best-effort post-upload work
// (thumbnails, search indexing). It starts lazily so a zero App works in tests.
type bgPool struct {
	once  sync.Once
	queue chan bgJob
}

func (a *App) log() *slog.Logger {
	if a.Logger != nil {
		return a.Logger
	}
	return slog.Default()
}

// Log returns the app logger, falling back to slog.Default when unset.
func (a *App) Log() *slog.Logger { return a.log() }

func (a *App) startBackgroundPool() {
	a.bg.once.Do(func() {
		a.bg.queue = make(chan bgJob, bgQueueSize)
		for i := 0; i < bgWorkers; i++ {
			go a.bgWorker()
		}
	})
}

func (a *App) bgWorker() {
	for job := range a.bg.queue {
		a.runBackgroundJob(job)
	}
}

func (a *App) runBackgroundJob(job bgJob) {
	defer func() {
		if r := recover(); r != nil {
			a.log().Error("background job panicked", append([]any{"job", job.name, "panic", r}, job.args...)...)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), bgJobTimeout)
	defer cancel()
	if err := job.fn(ctx); err != nil {
		a.log().Warn("background job failed", append([]any{"job", job.name, "err", err}, job.args...)...)
	}
}

// RunBackground queues fn on the bounded worker pool. When the queue is full the
// job is dropped and logged rather than spawning an unbounded goroutine; the
// work it does must be recoverable (e.g. via the admin reindex endpoint).
func (a *App) RunBackground(name string, fn func(ctx context.Context) error, logArgs ...any) {
	a.startBackgroundPool()
	select {
	case a.bg.queue <- bgJob{name: name, fn: fn, args: logArgs}:
	default:
		a.log().Warn("background queue full; job dropped", append([]any{"job", name}, logArgs...)...)
	}
}

// SchedulePostUpload queues thumbnail generation and search indexing for a
// freshly written file.
func (a *App) SchedulePostUpload(workspaceID, nodeID uuid.UUID, mime, storageKey string) {
	args := []any{"workspace_id", workspaceID, "node_id", nodeID}
	a.RunBackground("search_index", func(ctx context.Context) error {
		return a.indexNodeText(ctx, workspaceID, nodeID, mime, storageKey)
	}, args...)
	a.RunBackground("thumbnail", func(ctx context.Context) error {
		return a.generateThumbnail(ctx, workspaceID, nodeID, mime, storageKey)
	}, args...)
}
