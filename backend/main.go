package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"rowful/appstate"
	"rowful/cache"
	"rowful/config"
	"rowful/handlers"
	"rowful/snapshots"
	"rowful/storage"
)

func main() {
	cfg := config.Load()
	store := cache.New()
	dataGate := appstate.NewDataGate()
	storageStore, err := storage.New(cfg.DatabasePath, cfg.AppEncryptionKey)
	if err != nil {
		log.Fatal(fmt.Errorf("failed to initialize sqlite storage: %w", err))
	}
	defer func() { _ = storageStore.Close() }()

	uploadHandler := handlers.NewUploadHandler(cfg, store, storageStore)
	sheetHandler := handlers.NewSheetHandler(store, storageStore)
	filesHandler := handlers.NewFilesHandler(store, storageStore)
	domainsHandler := handlers.NewDomainsHandler(cfg, storageStore)
	emailProfilesHandler := handlers.NewEmailProfilesHandler(storageStore)
	authHandler := handlers.NewAuthHandler(cfg, storageStore)
	snapshotService := snapshots.NewService(cfg, storageStore, store, dataGate)
	snapshotService.Start(context.Background())
	snapshotsHandler := handlers.NewSnapshotsHandler(storageStore, snapshotService)

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
		r.Group(func(api chi.Router) {
			api.Use(dataGate.Middleware)

			api.Route("/auth", func(auth chi.Router) {
				auth.Get("/session", authHandler.Session)
				auth.Post("/login", authHandler.Login)
				auth.Post("/signup", authHandler.Signup)
				auth.Post("/logout", authHandler.Logout)
			})

			api.Group(func(private chi.Router) {
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
				private.Post("/files/folders", filesHandler.CreateFolder)
				private.Get("/email-profiles", emailProfilesHandler.List)
				private.Post("/email-profiles", emailProfilesHandler.Create)
				private.Patch("/email-profiles/{id}", emailProfilesHandler.Update)
				private.Delete("/email-profiles/{id}", emailProfilesHandler.Delete)
				private.Post("/files/{id}/open", filesHandler.Open)
				private.Post("/files/{id}/move", filesHandler.MoveFile)
				private.Get("/files/{id}/download", filesHandler.Download)
				private.Get("/files/{id}/settings", filesHandler.GetSettings)
				private.Patch("/files/{id}/settings", filesHandler.UpdateSettings)
				private.Post("/files/{id}/email/send", filesHandler.SendEmail)
				private.Post("/files/{id}/email/test", filesHandler.SendTestEmail)
				private.Patch("/files/{id}", filesHandler.Rename)
				private.Delete("/files/{id}", filesHandler.Delete)
				private.Patch("/files/folders/{id}", filesHandler.RenameFolder)
				private.Post("/files/folders/{id}/move", filesHandler.MoveFolder)
				private.Delete("/files/folders/{id}", filesHandler.DeleteFolder)

				private.Group(func(admin chi.Router) {
					admin.Use(authHandler.RequireAdmin)
					admin.Get("/domains", domainsHandler.List)
					admin.Post("/domains/check", domainsHandler.Check)
					admin.Post("/domains", domainsHandler.Create)
					admin.Get("/admin/signup-policy", authHandler.GetSignupPolicy)
					admin.Patch("/admin/signup-policy", authHandler.UpdateSignupPolicy)
					admin.Get("/admin/allowlist", authHandler.ListAllowlist)
					admin.Post("/admin/allowlist", authHandler.AddAllowlist)
					admin.Delete("/admin/allowlist", authHandler.DeleteAllowlist)
					admin.Get("/admin/snapshots", snapshotsHandler.Get)
					admin.Patch("/admin/snapshots", snapshotsHandler.Update)
					admin.Post("/admin/snapshots/run", snapshotsHandler.Run)
				})
			})
		})

		r.Post("/admin/snapshots/restore", func(w http.ResponseWriter, r *http.Request) {
			dataGate.RLock()
			authorizedRequest, status, clearCookie, err := authHandler.AuthorizeAdminRequest(r)
			dataGate.RUnlock()
			if err != nil {
				if clearCookie {
					handlers.ClearSessionCookie(w, r)
				}
				handlers.WriteJSON(w, status, map[string]string{"error": err.Error()})
				return
			}
			snapshotsHandler.Restore(w, authorizedRequest)
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
