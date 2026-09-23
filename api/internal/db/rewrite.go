package db

import (
	"strconv"
	"strings"
	"sync"
	"unicode"
)

// rewritten is a statement translated for SQLite.
type rewritten struct {
	sql string
	// nowParam is the $N placeholder that replaced now(), or 0. The caller
	// binds the statement's (or transaction's) timestamp to it, so now() is
	// one value per statement / transaction as in PostgreSQL.
	nowParam int
}

var rewriteCache sync.Map // string -> rewritten

// rewriteForSQLite translates the PostgreSQL spellings Arkive allows in
// portable SQL (see README.md) into SQLite:
//
//	$1, $2 …                 kept: SQLite binds $NNN by position
//	x::type                  cast removed (values are converted in Go)
//	now()                    a bound UTC timestamp parameter
//	ILIKE                    LIKE (SQLite LIKE is ASCII case-insensitive)
//	OFFSET n without LIMIT   LIMIT -1 OFFSET n
//	FOR UPDATE [OF t] [SKIP LOCKED | NOWAIT]
//	                         removed: SQLite transactions hold the one write
//	                         lock (BEGIN IMMEDIATE), so rows are already safe
//
// String literals, quoted identifiers and comments are left untouched.
func rewriteForSQLite(src string) rewritten {
	if v, ok := rewriteCache.Load(src); ok {
		return v.(rewritten)
	}
	r := doRewrite(src)
	rewriteCache.Store(src, r)
	return r
}

func doRewrite(src string) rewritten {
	maxParam := 0
	scanSQL(src, func(kind tokenKind, tok string) {
		if kind == tokParam {
			if n, err := strconv.Atoi(tok[1:]); err == nil && n > maxParam {
				maxParam = n
			}
		}
	})

	var toks []token
	scanSQL(src, func(kind tokenKind, tok string) { toks = append(toks, token{kind, tok}) })

	var b strings.Builder
	b.Grow(len(src))
	nowParam := 0
	// limitSeen[depth]: a LIMIT was written at this parenthesis depth, so a
	// following OFFSET is valid SQLite (which rejects OFFSET without LIMIT).
	limitSeen := []bool{false}
	for i := 0; i < len(toks); i++ {
		t := toks[i]
		switch {
		case t.kind == tokOther && t.text == "(":
			limitSeen = append(limitSeen, false)
			b.WriteString(t.text)
		case t.kind == tokOther && t.text == ")":
			if len(limitSeen) > 1 {
				limitSeen = limitSeen[:len(limitSeen)-1]
			}
			b.WriteString(t.text)
		case t.kind == tokWord && strings.EqualFold(t.text, "limit"):
			limitSeen[len(limitSeen)-1] = true
			b.WriteString(t.text)
		case t.kind == tokWord && strings.EqualFold(t.text, "offset"):
			if !limitSeen[len(limitSeen)-1] {
				b.WriteString("LIMIT -1 ")
			}
			b.WriteString(t.text)
		case t.kind == tokOther && t.text == "::":
			// Drop the cast and its type name, e.g. ::jsonb, ::timestamptz,
			// ::text[], ::double precision is not supported (not used).
			j := nextSignificant(toks, i+1)
			if j < len(toks) && toks[j].kind == tokWord {
				i = j
				if i+1 < len(toks) && toks[i+1].text == "[" && i+2 < len(toks) && toks[i+2].text == "]" {
					i += 2
				}
				continue
			}
			b.WriteString(t.text)
		case t.kind == tokWord && strings.EqualFold(t.text, "now"):
			j := nextSignificant(toks, i+1)
			k := nextSignificant(toks, j+1)
			if j < len(toks) && toks[j].text == "(" && k < len(toks) && toks[k].text == ")" {
				if nowParam == 0 {
					nowParam = maxParam + 1
				}
				b.WriteString("$" + strconv.Itoa(nowParam))
				i = k
				continue
			}
			b.WriteString(t.text)
		case t.kind == tokWord && strings.EqualFold(t.text, "ilike"):
			b.WriteString("LIKE")
		case t.kind == tokWord && strings.EqualFold(t.text, "for"):
			j := nextSignificant(toks, i+1)
			if j < len(toks) && toks[j].kind == tokWord && (strings.EqualFold(toks[j].text, "update") || strings.EqualFold(toks[j].text, "share")) {
				end := j
				// OF table[, table]
				if n := nextSignificant(toks, end+1); n < len(toks) && strings.EqualFold(toks[n].text, "of") {
					end = n
					for {
						n = nextSignificant(toks, end+1)
						if n >= len(toks) || toks[n].kind != tokWord || isLockKeyword(toks[n].text) {
							break
						}
						end = n
						c := nextSignificant(toks, end+1)
						if c < len(toks) && toks[c].text == "," {
							end = c
							continue
						}
						break
					}
				}
				// SKIP LOCKED | NOWAIT
				if n := nextSignificant(toks, end+1); n < len(toks) {
					switch {
					case strings.EqualFold(toks[n].text, "nowait"):
						end = n
					case strings.EqualFold(toks[n].text, "skip"):
						if m := nextSignificant(toks, n+1); m < len(toks) && strings.EqualFold(toks[m].text, "locked") {
							end = m
						}
					}
				}
				i = end
				b.WriteString(" ")
				continue
			}
			b.WriteString(t.text)
		default:
			b.WriteString(t.text)
		}
	}
	return rewritten{sql: b.String(), nowParam: nowParam}
}

func isLockKeyword(s string) bool {
	return strings.EqualFold(s, "skip") || strings.EqualFold(s, "nowait") || strings.EqualFold(s, "limit") || strings.EqualFold(s, "offset")
}

type tokenKind int

const (
	tokSpace   tokenKind = iota
	tokComment           // -- … or /* … */
	tokString            // '…' (also E'…')
	tokIdent             // "…"
	tokParam             // $N
	tokWord              // keyword / identifier
	tokOther             // punctuation, numbers, operators
)

type token struct {
	kind tokenKind
	text string
}

func nextSignificant(toks []token, i int) int {
	for i < len(toks) && (toks[i].kind == tokSpace || toks[i].kind == tokComment) {
		i++
	}
	return i
}

// scanSQL is a minimal lexer: enough to never rewrite inside literals.
func scanSQL(s string, emit func(tokenKind, string)) {
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == '\'':
			j := i + 1
			for j < len(s) {
				if s[j] == '\'' {
					if j+1 < len(s) && s[j+1] == '\'' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			j = min(j+1, len(s))
			emit(tokString, s[i:j])
			i = j
		case c == '"':
			j := i + 1
			for j < len(s) && s[j] != '"' {
				j++
			}
			j = min(j+1, len(s))
			emit(tokIdent, s[i:j])
			i = j
		case c == '-' && i+1 < len(s) && s[i+1] == '-':
			j := strings.IndexByte(s[i:], '\n')
			if j < 0 {
				j = len(s) - i
			}
			emit(tokComment, s[i:i+j])
			i += j
		case c == '/' && i+1 < len(s) && s[i+1] == '*':
			j := strings.Index(s[i+2:], "*/")
			end := len(s)
			if j >= 0 {
				end = i + 2 + j + 2
			}
			emit(tokComment, s[i:end])
			i = end
		case c == '$' && i+1 < len(s) && s[i+1] >= '0' && s[i+1] <= '9':
			j := i + 1
			for j < len(s) && s[j] >= '0' && s[j] <= '9' {
				j++
			}
			emit(tokParam, s[i:j])
			i = j
		case c == ':' && i+1 < len(s) && s[i+1] == ':':
			emit(tokOther, "::")
			i += 2
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			j := i
			for j < len(s) && (s[j] == ' ' || s[j] == '\t' || s[j] == '\n' || s[j] == '\r') {
				j++
			}
			emit(tokSpace, s[i:j])
			i = j
		case isWordStart(rune(c)):
			j := i
			for j < len(s) && isWordPart(rune(s[j])) {
				j++
			}
			emit(tokWord, s[i:j])
			i = j
		default:
			emit(tokOther, s[i:i+1])
			i++
		}
	}
}

func isWordStart(r rune) bool { return r == '_' || r >= 0x80 || unicode.IsLetter(r) }
func isWordPart(r rune) bool  { return isWordStart(r) || (r >= '0' && r <= '9') }
