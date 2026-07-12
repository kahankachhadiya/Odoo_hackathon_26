// Dropdown for selecting a bookable asset.
// The caller is responsible for pre-filtering assets to only bookable ones.
// Requirements: 7.1, 7.2

import type { Asset } from '../types/index'

// ─── Props ────────────────────────────────────────────────────────────────────

interface BookableAssetSelectProps {
  onSelect: (asset: Asset | null) => void
  assets: Asset[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookableAssetSelect({
  onSelect,
  assets,
}: BookableAssetSelectProps) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    if (value === '') {
      onSelect(null)
    } else {
      const found = assets.find((a) => a.id === value) ?? null
      onSelect(found)
    }
  }

  return (
    <div style={styles.wrapper}>
      <label htmlFor="bookable-asset-select" style={styles.label}>
        Select Asset
      </label>
      <select
        id="bookable-asset-select"
        onChange={handleChange}
        defaultValue=""
        style={styles.select}
        aria-label="Select a bookable asset"
      >
        <option value="">— Choose an asset —</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.tag} — {asset.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  select: {
    padding: '0.8rem 1rem',
    fontSize: '0.9rem',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-pill)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-secondary)',
    cursor: 'pointer',
  },
}
