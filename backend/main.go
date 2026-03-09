package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"planar/cache"
	"planar/config"
	"planar/handlers"
	"planar/storage"
)

func main() {
	cfg := config.Load()
	store := cache.New()
	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		log.Fatal(fmt.Errorf("failed to create upload directory: %w", err))
	}
	storageStore, err := storage.New(cfg.DatabasePath)
	if err != nil {
		log.Fatal(fmt.Errorf("failed to initialize sqlite storage: %w", err))
	}
	defer func() { _ = storageStore.Close() }()

	uploadHandler := handlers.NewUploadHandler(cfg, store, storageStore)
	sheetHandler := handlers.NewSheetHandler(store, storageStore)
	filesHandler := handlers.NewFilesHandler(store, storageStore)

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	router.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	router.Route("/api", func(r chi.Router) {
		r.Post("/upload", uploadHandler.Handle)
		r.Get("/sheet/{id}", sheetHandler.Get)
		r.Post("/sheet/{id}/cell", sheetHandler.UpdateCell)
		r.Post("/sheet/{id}/style", sheetHandler.ApplyStyle)
		r.Post("/sheet/{id}/clear-formatting", sheetHandler.ClearFormatting)
		r.Post("/sheet/{id}/clear-values", sheetHandler.ClearValues)
		r.Post("/sheet/{id}/save", sheetHandler.SaveSheet)
		r.Post("/sheet/{id}/create", sheetHandler.CreateSheet)
		r.Post("/sheet/{id}/rename", sheetHandler.RenameSheet)
		r.Post("/sheet/{id}/delete", sheetHandler.DeleteSheet)
		r.Post("/sheet/{id}/resize", sheetHandler.ResizeSheet)
		r.Post("/sheet/{id}/insert-rows", sheetHandler.InsertRows)
		r.Post("/sheet/{id}/insert-cols", sheetHandler.InsertCols)
		r.Post("/sheet/{id}/delete-rows", sheetHandler.DeleteRows)
		r.Post("/sheet/{id}/delete-cols", sheetHandler.DeleteCols)
		r.Get("/files", filesHandler.List)
		r.Get("/files/recent", filesHandler.Recent)
		r.Post("/files/{id}/open", filesHandler.Open)
		r.Get("/files/{id}/settings", filesHandler.GetSettings)
		r.Patch("/files/{id}/settings", filesHandler.UpdateSettings)
		r.Post("/files/{id}/email/send", filesHandler.SendEmail)
		r.Post("/files/{id}/email/test", filesHandler.SendTestEmail)
		r.Patch("/files/{id}", filesHandler.Rename)
		r.Delete("/files/{id}", filesHandler.Delete)
	})

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	log.Printf("Planar backend running on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(fmt.Errorf("server failed: %w", err))
	}
}
