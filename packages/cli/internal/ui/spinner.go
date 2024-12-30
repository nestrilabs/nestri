package ui

import (
	"fmt"
	"os"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/log"
)

type errMsg error

type model struct {
	spinner     spinner.Model
	loading     bool
	err         error
	loadingText string
	message     string
	taskFunc    func() tea.Msg // Function to execute the long-running task
}
type Spinner struct{}

func NewSpinner() *Spinner {
	return &Spinner{}
}

// RunSpinner runs the spinner while executing the provided task function
func (m *Spinner) RunSpinner(taskFunc func() tea.Msg, loadingText string) {
	p := tea.NewProgram(m.initialSpinnerModel(taskFunc, loadingText))
	if _, err := p.Run(); err != nil {
		log.Error("Failed to run the cmd spinner", "err", err)
		os.Exit(1)
	}
}

func (m *Spinner) initialSpinnerModel(taskFunc func() tea.Msg, loadingText string) model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))
	return model{
		spinner:     s,
		loading:     true,
		taskFunc:    taskFunc,
		loadingText: loadingText,
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick, // Start the spinner
		m.taskFunc,     // Start the long-running task
	)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			m.loading = false
			return m, tea.Quit
		default:
			return m, nil
		}
	case errMsg:
		m.err = msg
		return m, nil
	case string:
		// Task completed
		m.loading = false
		m.message = msg
		return m, tea.Quit

	default:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}
}

func (m model) View() string {
	if m.err != nil {
		return m.err.Error()
	}
	if m.loading {
		return fmt.Sprintf("\n\n   %s %s \n\n", m.spinner.View(), m.loadingText)
	}
	return m.message // fmt.Sprintf("\n ✅ %s \n\n", m.message)
}
