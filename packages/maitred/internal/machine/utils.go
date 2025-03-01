package machine

import (
	"os"
	"strings"
)

func readFile(filename string) ([]byte, error) {
	return os.ReadFile(filename)
}

func trim(s string) string {
	return strings.TrimSpace(strings.Trim(s, "\n"))
}
