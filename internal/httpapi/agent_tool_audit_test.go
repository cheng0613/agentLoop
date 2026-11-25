package httpapi

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// 审计参数摘要必须抹掉凭据，否则等于把密钥写进数据库。
func TestAuditArgsDigestRedactsSecrets(t *testing.T) {
	digest := auditArgsDigest(map[string]any{
		"nodeId":   "review",
		"token":    "sk-live-123",
		"password": "hunter2",
		"apiKey":   "ak-999",
		"secret":   "s3cr3t",
	})
	for _, leaked := range []string{"sk-live-123", "hunter2", "ak-999", "s3cr3t"} {
		if strings.Contains(digest, leaked) {
			t.Fatalf("digest leaked %q: %s", leaked, digest)
		}
	}
	if !strings.Contains(digest, "review") {
		t.Fatalf("digest must keep ordinary arguments: %s", digest)
	}
}

// 超长参数要截断，避免把审计表撑爆。
func TestAuditArgsDigestTruncates(t *testing.T) {
	digest := auditArgsDigest(map[string]any{"body": strings.Repeat("x", 4000)})
	// truncateRunes 按 rune 截断并补省略号；len() 数的是字节，所以按 rune 断言。
	if got := utf8.RuneCountInString(digest); got > 1001 {
		t.Fatalf("digest not truncated: %d runes", got)
	}
}

func TestAuditArgsDigestEmpty(t *testing.T) {
	if got := auditArgsDigest(nil); got != "" {
		t.Fatalf("empty args must give empty digest, got %q", got)
	}
}
