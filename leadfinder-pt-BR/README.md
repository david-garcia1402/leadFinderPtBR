# Lead Finder by cub4Studio — Português — v0.2.0

## Início rápido
Requer Node.js 22.9+ (testado com Node 24.19). Não há dependências externas de produção.
Abra um terminal nesta pasta e execute:

```bash
npm run dev
```

Página comercial: http://127.0.0.1:4173
Painel: http://127.0.0.1:4173/app

```bash
npm test
npm run build
```

O build já está incluído em `dist/`. Para rodar só a distribuição:

```bash
cd dist
node --env-file-if-exists=.env server.mjs
```

Não é um site puramente estático: o painel depende do servidor Node. Não abrir index.html diretamente. Não importar como tema Shopify. Não enviar a pasta dist diretamente a um Cloudflare Worker.

## O que mudou
- Página comercial em português, separada do painel, com copy de benefícios, recursos, FAQ e contato.
- Nova assinatura vetorial Lead Finder; mantém roxo/coral. É uma proposta visual do produto, não uma reprodução certificada da logo corporativa.
- Prévia do produto em HTML/CSS, nítida em qualquer tela e sem imagens de banco genéricas. Empresas da prévia são fictícias e identificadas.
- Três planos em colunas no desktop e empilhados no celular. Profissional em destaque.
- Preços propostos: R$ 39,99 / 59,99 / 89,99; franquias propostas: 100 / 300 / 600 empresas. Não estão conectados ao consumo. Devem ser validados antes de venda.
- O botão de cada plano abre `/entrar?plano=` e, depois do login, o checkout Kiwify correspondente.
- Exemplos desativados por padrão. Nunca substitui silenciosamente a busca real por dados fictícios.
- Preservados filtros, favoritos no navegador, CSV e rascunho de abordagem.
- Configuração explícita de origem HTTPS, menor exposição de informações do servidor e restrição adicional para busca real local.

## Conectar a busca real para uso local
Copie `.env.example` para `.env`. Preencha `OUTSCRAPER_API_KEY`, defina `ENABLE_LIVE_SEARCH=true` e mantenha `HOST=127.0.0.1`. Use `APP_ORIGIN=http://127.0.0.1:4173` e abra exatamente esse endereço. Defina um teto conservador em `MAX_MONTHLY_RECORDS`. Reinicie o servidor. Se executar dist, coloque o .env dentro de dist.
Não inclua .env em ZIP, Git ou frontend. A chave permanece no servidor.
A integração foi preservada; não foi testada com credenciais reais. Antes de consumir, confirme custos, permissões e limites da sua conta no provedor. Nenhum crédito ou serviço foi contratado.
O teto local é global, não por assinante nem um teto financeiro no provedor. Reservas não são estornadas automaticamente em falhas. Use uma única instância; jobs/cache são em memória. A renovação mensal ocorre na inicialização. Não reinicie durante consultas pendentes.

## Exemplos para desenvolvimento
Opcionalmente defina `ENABLE_SAMPLE_DATA=true` e escolha a fonte de exemplos no painel. Dados ficam explicitamente identificados como fictícios. Não use exemplos como resultados reais em anúncios. Dados salvos nesta versão ficam apenas no navegador.

## Estado real do produto
Esta versão pt-BR agora tem contas com e-mail/senha, sessão HttpOnly e franquia por cliente. O checkout padrão é a **Kiwify**, com adaptadores para Mercado Pago e para qualquer checkout hospedado (Hotmart, Eduzz, Stripe Payment Link, etc.). Sem variáveis, os três checkouts públicos (Essencial, Profissional e Escala) são usados. A franquia só libera com `KIWIFY_WEBHOOK_TOKEN`. Use o mesmo e-mail da compra e da conta. Não anunciar retorno financeiro.

Ainda faltam antes de vender em escala: recuperação de acesso por e-mail; banco dedicado; exclusão/retenção de dados; documentos reais de privacidade/termos; observabilidade e um pagamento de teste ponta a ponta. Não há pixels de publicidade nesta versão.

## Contas e checkout
Copie `.env.example` para `.env`. Contas ficam em `.data/accounts.json`. Rotas: `/entrar`, `/conta`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `GET /api/plans`, `POST /api/billing/checkout`, `POST /api/billing/webhook` (também `/kiwify`, `/mercadopago` e `/hosted`).

Defina `BILLING_PROVIDER=kiwify` (padrão), `mercadopago` ou `hosted`.

Kiwify: crie 3 produtos/ofertas (Essencial, Profissional, Escala). Cole os links em `KIWIFY_CHECKOUT_*`, os `product_id` em `KIWIFY_PRODUCT_*` e o token de Apps → Webhooks em `KIWIFY_WEBHOOK_TOKEN`. Eventos: `compra_aprovada`, `subscription_renewed`, `compra_reembolsada`, `chargeback`, `subscription_canceled`, `subscription_late`. URL: `{APP_ORIGIN}/api/billing/webhook/kiwify`.

Checkout genérico: `BILLING_PROVIDER=hosted`, `CHECKOUT_URL_*`, `BILLING_WEBHOOK_SECRET` e, se quiser, `BILLING_PRODUCT_*`. O webhook aceita `{ "token", "event":"purchase.approved", "email", "planId", "orderId" }` ou HMAC `x-billing-signature`.

Mercado Pago: `BILLING_PROVIDER=mercadopago`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `APP_ORIGIN` HTTPS.

A franquia libera no webhook ou, se a pessoa pagar antes de criar a conta, no próximo login com o mesmo e-mail. Sem as variáveis, criar conta funciona e o checkout responde 503.

A busca real exige sessão e assinatura autorizada. Os exemplos (`ENABLE_SAMPLE_DATA=true`) continuam disponíveis sem conta, só para prévia local.

## Análise para campanha
A dor mais concreta é o tempo gasto procurando empresas e organizando prospecção. Público inicial sugerido: freelancers de sites e pequenas agências. Oferta: encontrar empresas por região e priorizar as que não têm site listado. Não alegar “clientes prontos para comprar” nem “empresas sem site confirmado”.
Antes de tráfego de assinatura: medir custo por resultado e margem, validar franquias, fazer busca real e pagamento/cancelamento de ponta a ponta. A página atual serve para apresentação e conversas de pré-lançamento; o contato aponta a cub4studio.com/#contato. Confirme esse destino antes de publicar.
Preços e franquias são hipóteses comerciais, não recomendações baseadas em tarifas atuais. Descontos por volume podem destruir a margem se o custo de dados for alto.

## Editar
`public/index.html`: página comercial, preços e contatos.
`public/landing.css`: identidade e layout.
`public/landing.js`: seleção de interesse.
`public/workspace.html`, `public/app.js`, `public/style.css`: painel.
`public/auth.html`, `public/account.html` e respectivos JS: conta e plano.
`public/logo.svg`: símbolo vetorial.
`server.mjs` e `lib/`: backend, autenticação e provedores de checkout (Kiwify, Mercado Pago, genérico).
Depois de qualquer edição, execute npm test e npm run build para atualizar dist.

## Validação
Build Node e testes automatizados executados nesta entrega. Verificação HTTP de páginas, assets, bloqueio de exemplos, origem e proteção de arquivos internos. Validação visual em navegador depende da disponibilidade do Chromium no ambiente; veja VALIDATION.md. Nenhum pagamento, chamada paga ao provedor ou deploy público foi realizado.

## SEO deployment configuration / Configuração de SEO

Set `PUBLIC_SITE_URL` to this deployment's real HTTPS origin, without a path. Set `EN_SITE_URL` and `PT_BR_SITE_URL` to the two distinct production origins in **both** deployments to emit reciprocal hreflang links. These fields are not inferred from request headers or the corporate website. Blank/invalid `PUBLIC_SITE_URL` disables indexing (robots + X-Robots-Tag), omits canonical and makes `/sitemap.xml` return 503. This keeps staging/local deployments out of search.

Defina `PUBLIC_SITE_URL` com a origem HTTPS real desta versão, sem caminho. Configure `EN_SITE_URL` e `PT_BR_SITE_URL` nas duas versões. Valores vazios mantêm a indexação desativada. Reinicie o servidor após configurar. As versões são aplicações separadas e devem ser publicadas em origens distintas; hospedagem em subdiretórios não é suportada.

The server emits canonical/og:url, a landing-only sitemap and robots rules. The workspace has noindex. Localized title, description, Open Graph, Twitter summary and SoftwareApplication JSON-LD describe existing features. No paid Offer schema is published before billing exists. No ranking or rich-result guarantee.

Plan CTAs now send visitors to `/entrar` with the selected plan. The local prospecting brief remains available. Checkout uses Kiwify by default and can switch to Mercado Pago or another hosted checkout. It stays inactive without credentials. No analytics conversion is recorded.
