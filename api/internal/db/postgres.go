package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgDB is DB over a pgxpool. Queries go to pgx untouched.
type pgDB struct{ pool *pgxpool.Pool }

func openPostgres(ctx context.Context, dsn string) (DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &pgDB{pool: pool}, nil
}

// PgxPool exposes the underlying pool of a PostgreSQL DB (nil for SQLite).
// Only for PostgreSQL-specific tooling and tests.
func PgxPool(d DB) *pgxpool.Pool {
	if p, ok := d.(*pgDB); ok {
		return p.pool
	}
	return nil
}

func (p *pgDB) Dialect() Dialect               { return Postgres }
func (p *pgDB) Ping(ctx context.Context) error { return p.pool.Ping(ctx) }
func (p *pgDB) Close()                         { p.pool.Close() }

func (p *pgDB) Exec(ctx context.Context, sql string, args ...any) (CommandTag, error) {
	tag, err := p.pool.Exec(ctx, sql, args...)
	return CommandTag{rows: tag.RowsAffected()}, err
}

func (p *pgDB) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	rows, err := p.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (p *pgDB) QueryRow(ctx context.Context, sql string, args ...any) Row {
	return pgRow{p.pool.QueryRow(ctx, sql, args...)}
}

func (p *pgDB) Begin(ctx context.Context) (Tx, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return pgTx{tx}, nil
}

type pgTx struct{ tx pgx.Tx }

func (t pgTx) Dialect() Dialect { return Postgres }

func (t pgTx) Exec(ctx context.Context, sql string, args ...any) (CommandTag, error) {
	tag, err := t.tx.Exec(ctx, sql, args...)
	return CommandTag{rows: tag.RowsAffected()}, err
}

func (t pgTx) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	rows, err := t.tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (t pgTx) QueryRow(ctx context.Context, sql string, args ...any) Row {
	return pgRow{t.tx.QueryRow(ctx, sql, args...)}
}

func (t pgTx) Commit(ctx context.Context) error { return t.tx.Commit(ctx) }

func (t pgTx) Rollback(ctx context.Context) error {
	err := t.tx.Rollback(ctx)
	if errors.Is(err, pgx.ErrTxClosed) {
		return nil
	}
	return err
}

type pgRow struct{ row pgx.Row }

func (r pgRow) Scan(dest ...any) error {
	err := r.row.Scan(dest...)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNoRows
	}
	return err
}
