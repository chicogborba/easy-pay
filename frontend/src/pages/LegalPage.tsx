import { Link as RouterLink } from 'react-router-dom'
import { useApp } from '../lib/app'
import { Card } from '../components/ui'

/*
 * TEMPLATE legal texts. Have a lawyer review them before a public launch
 * (Brazil: LGPD; US: state privacy laws). Portuguese for Brazil, English otherwise.
 */

const TEXT = {
  terms: {
    en: {
      title: 'Terms of use',
      body: [
        'Easy Pay helps small businesses create payment links and keep track of their sales and customers.',
        'Payments are processed by our partners (Stripe or Mercado Pago). The money goes to the account you connect; Easy Pay never holds your funds.',
        'Easy Pay charges a fee per paid sale, shown in Settings. There is no monthly fee. Fees may change with 30 days notice.',
        'You must sell only legal products and services, describe them honestly and deliver what you sell. Refunds and customer disputes are your responsibility, handled through your payment provider.',
        'We may suspend accounts used for fraud, prohibited goods or abuse.',
        'The service is provided as is. To the extent allowed by law, our liability is limited to the fees you paid us in the last 3 months.',
        'You can close your account at any time by contacting support.',
      ],
    },
    pt: {
      title: 'Termos de uso',
      body: [
        'O Easy Pay ajuda pequenos negócios a criar links de pagamento e acompanhar suas vendas e clientes.',
        'Os pagamentos são processados por parceiros (Mercado Pago ou Stripe). O dinheiro vai para a conta que você conectar; o Easy Pay nunca fica com o seu dinheiro.',
        'O Easy Pay cobra uma taxa por venda paga, mostrada em Ajustes. Não há mensalidade. A taxa pode mudar com aviso de 30 dias.',
        'Você deve vender apenas produtos e serviços legais, descrevê-los com honestidade e entregar o que vendeu. Reembolsos e contestações são sua responsabilidade, tratados pelo seu provedor de pagamento.',
        'Podemos suspender contas usadas para fraude, produtos proibidos ou abuso.',
        'O serviço é oferecido como está. Na medida permitida por lei, nossa responsabilidade é limitada às taxas pagas nos últimos 3 meses.',
        'Você pode encerrar sua conta a qualquer momento falando com o suporte.',
      ],
    },
  },
  privacy: {
    en: {
      title: 'Privacy policy',
      body: [
        'What we collect: your name, email, phone, business details and tax id (to verify who receives money), the links you create, and your customers’ name and phone when they pay.',
        'Why: to run the service, send your money to the right person, prevent fraud, and show you your sales.',
        'Who we share it with: the payment provider you connect (Stripe or Mercado Pago), and service providers that host the app and send emails. We never sell your data.',
        'Your customers’ data belongs to you; we process it on your behalf.',
        'Security: passwords are hashed, payment tokens are encrypted, and connections use HTTPS.',
        'Your rights: you can see, correct or delete your data by contacting support.',
      ],
    },
    pt: {
      title: 'Política de privacidade',
      body: [
        'O que coletamos: seu nome, e-mail, telefone, dados do negócio e CPF/CNPJ (para saber quem recebe o dinheiro), os links que você cria, e nome e telefone dos seus clientes quando pagam.',
        'Para quê: para o serviço funcionar, enviar o dinheiro para a pessoa certa, evitar fraudes e mostrar suas vendas.',
        'Com quem compartilhamos: o provedor de pagamento que você conectar (Mercado Pago ou Stripe) e empresas que hospedam o app e enviam e-mails. Nunca vendemos seus dados.',
        'Os dados dos seus clientes são seus; nós tratamos em seu nome (LGPD).',
        'Segurança: senhas são criptografadas, tokens de pagamento são cifrados e as conexões usam HTTPS.',
        'Seus direitos: você pode ver, corrigir ou apagar seus dados falando com o suporte.',
      ],
    },
  },
}

export default function LegalPage({ doc }: { doc: 'terms' | 'privacy' }) {
  const { settings } = useApp()
  const text = TEXT[doc][settings.lang === 'pt' ? 'pt' : 'en']
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <RouterLink to="/welcome" className="font-heading text-3xl font-bold">
        Easy<span className="inline-block -rotate-6 text-marker">Pay</span>
      </RouterLink>
      <Card decoration="tape" className="mt-8 space-y-4 !p-8">
        <h1 className="font-heading text-4xl font-bold">{text.title}</h1>
        {text.body.map((p) => (
          <p key={p} className="text-xl leading-relaxed">
            {p}
          </p>
        ))}
      </Card>
    </div>
  )
}
