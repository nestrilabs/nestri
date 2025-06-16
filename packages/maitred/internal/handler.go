package internal

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
)

type CustomHandler struct {
	Handler slog.Handler
}

func (h *CustomHandler) Enabled(_ context.Context, level slog.Level) bool {
	return h.Handler.Enabled(nil, level)
}

func (h *CustomHandler) Handle(_ context.Context, r slog.Record) error {
	// Format the timestamp as "2006/01/02 15:04:05"
	timestamp := r.Time.Format("2006/01/02 15:04:05")
	// Convert level to uppercase string (e.g., "INFO")
	level := strings.ToUpper(r.Level.String())
	// Build the message
	msg := fmt.Sprintf("%s %s %s", timestamp, level, r.Message)

	// Handle additional attributes if they exist
	var attrs []string
	r.Attrs(func(a slog.Attr) bool {
		attrs = append(attrs, fmt.Sprintf("%s=%v", a.Key, a.Value))
		return true
	})
	if len(attrs) > 0 {
		msg += " " + strings.Join(attrs, " ")
	}

	// Write the formatted message to stdout
	_, err := fmt.Fprintln(os.Stdout, msg)
	return err
}

func (h *CustomHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &CustomHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h *CustomHandler) WithGroup(name string) slog.Handler {
	return &CustomHandler{Handler: h.Handler.WithGroup(name)}
}
