package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"rowful/cache"
	"rowful/config"
	"rowful/handlers"
	"rowful/storage"
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
	domainsHandler := handlers.NewDomainsHandler(cfg, storageStore)
	authHandler := handlers.NewAuthHandler(storageStore)

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
		AllowCredentials: true,
		MaxAge:           300,
	}))

	router.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	router.Route("/api", func(r chi.Router) {
		r.Route("/auth", func(auth chi.Router) {
			auth.Get("/session", authHandler.Session)
			auth.Post("/login", authHandler.Login)
			auth.Post("/signup", authHandler.Signup)
			auth.Post("/logout", authHandler.Logout)
		})

		r.Group(func(private chi.Router) {
			private.Use(authHandler.RequireAuth)
			private.Post("/upload", uploadHandler.Handle)
			private.Get("/sheet/{id}", sheetHandler.Get)
			private.Post("/sheet/{id}/cell", sheetHandler.UpdateCell)
			private.Post("/sheet/{id}/style", sheetHandler.ApplyStyle)
			private.Post("/sheet/{id}/clear-formatting", sheetHandler.ClearFormatting)
			private.Post("/sheet/{id}/clear-values", sheetHandler.ClearValues)
			private.Post("/sheet/{id}/kanban", sheetHandler.SaveKanbanRegions)
			private.Post("/sheet/{id}/save", sheetHandler.SaveSheet)
			private.Post("/sheet/{id}/create", sheetHandler.CreateSheet)
			private.Post("/sheet/{id}/rename", sheetHandler.RenameSheet)
			private.Post("/sheet/{id}/delete", sheetHandler.DeleteSheet)
			private.Post("/sheet/{id}/resize", sheetHandler.ResizeSheet)
			private.Post("/sheet/{id}/insert-rows", sheetHandler.InsertRows)
			private.Post("/sheet/{id}/insert-cols", sheetHandler.InsertCols)
			private.Post("/sheet/{id}/delete-rows", sheetHandler.DeleteRows)
			private.Post("/sheet/{id}/delete-cols", sheetHandler.DeleteCols)
			private.Get("/files", filesHandler.List)
			private.Post("/files", filesHandler.Create)
			private.Get("/files/recent", filesHandler.Recent)
			private.Post("/files/{id}/open", filesHandler.Open)
			private.Get("/files/{id}/settings", filesHandler.GetSettings)
			private.Patch("/files/{id}/settings", filesHandler.UpdateSettings)
			private.Post("/files/{id}/email/send", filesHandler.SendEmail)
			private.Post("/files/{id}/email/test", filesHandler.SendTestEmail)
			private.Patch("/files/{id}", filesHandler.Rename)
			private.Delete("/files/{id}", filesHandler.Delete)

			private.Group(func(admin chi.Router) {
				admin.Use(authHandler.RequireAdmin)
				admin.Get("/domains", domainsHandler.List)
				admin.Post("/domains/check", domainsHandler.Check)
				admin.Post("/domains", domainsHandler.Create)
				admin.Get("/admin/allowlist", authHandler.ListAllowlist)
				admin.Post("/admin/allowlist", authHandler.AddAllowlist)
				admin.Delete("/admin/allowlist", authHandler.DeleteAllowlist)
			})
		})
	})

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	log.Printf("Rowful backend running on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(fmt.Errorf("server failed: %w", err))
	}
}
