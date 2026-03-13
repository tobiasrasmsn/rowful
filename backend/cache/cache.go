package cache

import (
	"sort"
	"sync"
	"time"

	"rowful/models"
)

type CachedWorkbook struct {
	Workbook models.Workbook
}

type Store struct {
	byID   sync.Map
	byHash sync.Map
}

func New() *Store {
	return &Store{}
}

func (s *Store) Put(workbook CachedWorkbook) {
	s.byID.Store(workbook.Workbook.ID, workbook)
	s.byHash.Store(workbook.Workbook.FileHash, workbook.Workbook.ID)
}

func (s *Store) DeleteByID(id string) {
	value, ok := s.byID.Load(id)
	if ok {
		if workbook, castOK := value.(CachedWorkbook); castOK {
			s.byHash.Delete(workbook.Workbook.FileHash)
		}
	}
	s.byID.Delete(id)
}

func (s *Store) GetByID(id string) (CachedWorkbook, bool) {
	value, ok := s.byID.Load(id)
	if !ok {
		return CachedWorkbook{}, false
	}
	workbook, ok := value.(CachedWorkbook)
	if !ok {
		return CachedWorkbook{}, false
	}
	return workbook, true
}

func (s *Store) GetByHash(hash string) (CachedWorkbook, bool) {
	idValue, ok := s.byHash.Load(hash)
	if !ok {
		return CachedWorkbook{}, false
	}
	id, ok := idValue.(string)
	if !ok {
		return CachedWorkbook{}, false
	}
	return s.GetByID(id)
}

func BuildWorkbookMeta(id, fileName, fileHash string, sheets map[string]models.Sheet) models.Workbook {
	metas := make([]models.SheetMeta, 0, len(sheets))
	for _, sheet := range sheets {
		metas = append(metas, models.SheetMeta{
			Name:   sheet.Name,
			Index:  sheet.Index,
			MaxRow: sheet.MaxRow,
			MaxCol: sheet.MaxCol,
		})
	}

	sort.Slice(metas, func(i, j int) bool {
		return metas[i].Index < metas[j].Index
	})

	activeSheet := ""
	if len(metas) > 0 {
		activeSheet = metas[0].Name
	}

	return models.Workbook{
		ID:          id,
		FileName:    fileName,
		FileHash:    fileHash,
		Sheets:      metas,
		ActiveSheet: activeSheet,
		CreatedAt:   time.Now().UTC(),
	}
}
