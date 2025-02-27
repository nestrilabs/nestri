package realtime

import (
	"github.com/charmbracelet/log"
)

// logger implements the paho.Logger interface
type logger struct {
	prefix string
}

// Println is the library provided NOOPLogger's
// implementation of the required interface function()
func (l logger) Println(v ...interface{}) {
	// fmt.Println(append([]interface{}{l.prefix + ":"}, v...)...)
	log.Info(l.prefix, "info", v)
}

// Printf is the library provided NOOPLogger's
// implementation of the required interface function(){}
func (l logger) Printf(format string, v ...interface{}) {
	// if len(format) > 0 && format[len(format)-1] != '\n' {
	// 	format = format + "\n" // some log calls in paho do not add \n
	// }
	// fmt.Printf(l.prefix+":"+format, v...)
	log.Info(l.prefix, "info", v)
}
