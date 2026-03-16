package appstate

import (
	"net/http"
	"sync"
)

type DataGate struct {
	mu sync.RWMutex
}

func NewDataGate() *DataGate {
	return &DataGate{}
}

func (g *DataGate) RLock() {
	g.mu.RLock()
}

func (g *DataGate) RUnlock() {
	g.mu.RUnlock()
}

func (g *DataGate) Lock() {
	g.mu.Lock()
}

func (g *DataGate) Unlock() {
	g.mu.Unlock()
}

func (g *DataGate) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.RLock()
		defer g.RUnlock()
		next.ServeHTTP(w, r)
	})
}
