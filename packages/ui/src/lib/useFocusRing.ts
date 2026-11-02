import { useEffect } from 'react'

const TEXT_FIELD = 'textarea, input:not([type="checkbox"], [type="radio"])'

/** A key typed into a field leaves focus where it is, so it says nothing about how it got there. */
function isTyping(event: KeyboardEvent): boolean {
  return event.key !== 'Tab' && event.target instanceof Element && event.target.matches(TEXT_FIELD)
}

/**
 * Focus rings for the keyboard only. A text field matches :focus-visible however it got
 * focus, a click included, and CSS cannot tell the two apart. So a press turns the page's
 * rings off, and any key but typing turns them back on (tokens.css). With no script yet
 * the rings stay on.
 */
export function useFocusRing(): void {
  useEffect(() => {
    const page = document.documentElement
    const onPress = () => {
      page.style.setProperty('--focus-ring-style', 'none')
    }
    const onKey = (event: KeyboardEvent) => {
      if (!isTyping(event)) page.style.removeProperty('--focus-ring-style')
    }
    // Capturing, so this comes before the focus that the press or the key causes.
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('keydown', onKey, true)
      page.style.removeProperty('--focus-ring-style')
    }
  }, [])
}
