package web

import (
	"os"
	"os/exec"
	"testing"
)

// runNodeScript runs a Node script and returns its combined output.
//
// The harnesses below are inline sources rather than checked-in files, and many
// are far longer than a command line allows: Windows caps a process command line
// at 32 KB, so passing the whole script through `node -e` dies with "命令行太长"
// (the command line is too long) before any assertion runs. Writing the source
// to a temp file keeps the command line short and behaves the same everywhere.
//
// The file must live in the package working directory: the harnesses read
// relative assets like 'app.js' and 'index.html', so a file under the system
// temp dir would resolve those against the wrong root.
func runNodeScript(t *testing.T, node, script string) ([]byte, error) {
	t.Helper()
	// .cjs keeps require() available regardless of any package.json "type".
	file, err := os.CreateTemp(".", "node-harness-*.cjs")
	if err != nil {
		t.Fatalf("write node harness: %v", err)
	}
	path := file.Name()
	defer os.Remove(path)
	if _, err := file.WriteString(script); err != nil {
		file.Close()
		t.Fatalf("write node harness: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close node harness: %v", err)
	}
	return exec.Command(node, path).CombinedOutput()
}
