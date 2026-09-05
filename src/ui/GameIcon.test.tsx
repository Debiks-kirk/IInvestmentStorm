import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CARD_DEFINITIONS } from '../game/cards'
import { IDENTITY_DEFINITIONS } from '../game/identities'
import { CardIcon, IdentityIcon } from './GameIcon'

describe('game icon mappings', () => {
  it.each(CARD_DEFINITIONS)('renders $name without changing the accessible button name', ({ id, name }) => {
    const markup = renderToStaticMarkup(<button><CardIcon id={id} />{name}</button>)
    expect(markup).toContain(`/assets/icons/minimal-v1/cards/${id}.webp`)
    expect(markup).toContain('alt=""')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('draggable="false"')
    expect(markup).toContain(name)
  })

  it.each(IDENTITY_DEFINITIONS)('renders the separate $name identity asset', ({ id }) => {
    const markup = renderToStaticMarkup(<IdentityIcon id={id} />)
    expect(markup).toContain(`/assets/icons/minimal-v1/roles/${id}.webp`)
    expect(markup).toContain('width="256" height="256"')
    expect(markup).toContain('alt=""')
  })
})
