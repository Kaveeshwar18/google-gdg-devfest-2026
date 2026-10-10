// Server-side render of the real cart components with the English strings: catches crashes, missing
// translation keys, and checks the privacy-relevant bits of the markup. (No browser needed; node environment.)
// Zustand renders its initial state on the server, so store-dependent behaviour is covered in store.test.ts.
import i18next from 'i18next'
import { renderToString } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { StaticRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../../i18n/en/app.json'
import en from '../../i18n/en/cart.json'
import EvisaPage from '../evisa/EvisaPage'
import AppTypePicker from './AppTypePicker'
import CartPage from './CartPage'
import { runChecks } from './checks'
import ConfirmDoc from './ConfirmDoc'
import ResultCard from './ResultCard'
import { ADDRESS, TODAY, cleanDocs, doc } from './testkit'

const i18n = i18next.createInstance()
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: { ...app, ...en } } },
    interpolation: { escapeValue: false },
  })
})

const render = (node: React.ReactNode) =>
  renderToString(
    <I18nextProvider i18n={i18n}>
      <StaticRouter location="/cart">{node}</StaticRouter>
    </I18nextProvider>,
  )

// A raw key such as "cart.result.fix" on screen means a string is missing.
const noRawKeys = (html: string) => expect(html).not.toMatch(/cart\.[a-zA-Z_]+\.[a-zA-Z_.]+/)

describe('Document Cart screens render', () => {
  it('empty cart: picker, six document tiles, manual entry, check button disabled', () => {
    const html = render(<CartPage />)
    noRawKeys(html)
    expect(html).toContain('New passport')
    expect(html).toContain('Renew or re-issue')
    expect(html).toContain('Child under 18')
    for (const label of ['Aadhaar card', 'PAN card', 'Old passport', 'Class 10 certificate', 'Birth certificate'])
      expect(html).toContain(label)
    expect(html).toContain('Type it in')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Check my documents/)
    expect(html).toContain('Add and confirm at least one document')
  })

  it('confirm screen marks fields we could not read, and Aadhaar shows only a 4-digit box', () => {
    const d = { ...doc('aadhaar', { name: 'Asha Sharma' }, 'review') }
    const html = render(
      <ConfirmDoc doc={d} moveBlocked={false} freeTypes={['pan']} onConfirm={() => {}} onRemove={() => {}} onUseAs={() => {}} />,
    )
    noRawKeys(html)
    expect(html).toContain('Is this right?')
    expect(html).toContain('Yes, this is correct')
    expect(html).toContain('Read from your photo. Please check.')
    expect(html).toContain('Not read. Please type it in')
    expect(html).toContain('maxLength="4"')
    expect(html).toContain('We keep only the last 4 digits of your Aadhaar number.')
  })

  it('result card: every state renders with found / why / fix, a source link and the disclaimer', () => {
    const reports = {
      ready: runChecks(cleanDocs(), 'fresh', TODAY),
      almost_ready: runChecks([doc('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990' })], 'reissue', TODAY),
      not_ready: runChecks(
        [
          doc('aadhaar', { name: 'Asha Sharma', dob: '26/01/1990', address: ADDRESS }),
          doc('marksheet', { name: 'Rahul Verma', dob: '27/01/1990' }),
        ],
        'fresh',
        TODAY,
      ),
    }
    for (const [verdict, report] of Object.entries(reports)) {
      expect(report.verdict).toBe(verdict)
      const html = render(<ResultCard report={report} confirmed={['aadhaar']} onFix={() => {}} onBack={() => {}} />)
      noRawKeys(html)
      expect(html).toContain('Fix with Mitra')
      expect(html).toContain('not a guarantee of approval')
      expect(html).not.toMatch(/will be rejected/i)
    }
    const notReady = render(<ResultCard report={reports.not_ready} confirmed={['aadhaar']} onFix={() => {}} onBack={() => {}} />)
    expect(notReady).toContain('Not ready to book yet')
    expect(notReady).toContain('Needs fixing')
    expect(notReady).toContain('The name on your Aadhaar card and your Class 10 certificate look different.')
    const almost = render(<ResultCard report={reports.almost_ready} confirmed={['aadhaar']} onFix={() => {}} onBack={() => {}} />)
    expect(almost).toContain('Almost ready')
    expect(almost).toContain('Check on Passport Seva')
    expect(almost).toContain('href="https://www.passportindia.gov.in/')
    expect(almost).toContain('Please verify it there')
  })

  it('application-type picker lists exactly the three project types', () => {
    const html = render(<AppTypePicker value="fresh" onChange={() => {}} />)
    noRawKeys(html)
    expect(html.match(/type="radio"/g)).toHaveLength(3)
  })

  it('e-Visa pre-check form renders every question and its button', () => {
    const html = render(<EvisaPage />)
    noRawKeys(html)
    for (const label of ['Type of passport', 'Passport expiry date', 'Blank pages left in your passport', 'Date you plan to arrive in India', 'Are you of Pakistani origin?'])
      expect(html).toContain(label)
    expect(html).toContain('Check my e-Visa details')
    expect(html).toContain('never sent anywhere')
  })

  it('the Document Cart page links to the e-Visa pre-check', () => {
    expect(render(<CartPage />)).toContain('Visiting India? e-Visa pre-check')
  })
})
