# 🌼 Buttercup

Caderno de receitas pessoal, feito para usar no iPhone como app da Tela de Início (PWA).

HTML + CSS + JavaScript puro — sem build, sem dependências.

## Estrutura

```
public/
  index.html     metatags de PWA para iPhone
  styles.css     visual (cores, tamanhos, safe areas)
  app.js         telas: lista, receita, nova/editar
  config.js      URL e chave do Supabase (vazio = só no aparelho)
  db.js          Supabase + cache local (IndexedDB)
  sw.js          funciona offline
  manifest.json  nome, cores e ícones do app
  icon-*.png     ícones (gerados por scripts/make-icons.mjs)
api/parse.js   lê uma receita de um link (usado pelo app)
api/share.js   importa e salva direto (usado pelo Atalho do iPhone)
supabase/schema.sql   tabela e regras de segurança
vercel.json      publica a pasta public/
```

## Publicar na Vercel

1. Suba a pasta `buttercup` para um repositório no GitHub.
2. Na Vercel: **Add New → Project**, escolha o repositório, framework **Other**. Não precisa de build.
3. Deploy.

## Instalar no iPhone

1. Abra o link da Vercel no **Safari**.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. Abra sempre pelo ícone. As receitas ficam guardadas *dentro do app instalado*, que é separado do Safari.

## Supabase (nuvem)

1. Crie um projeto em supabase.com.
2. **SQL Editor → New query**: cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. **Authentication → Users → Add user → Create new user**: seu e-mail e uma senha
   (marque *Auto Confirm User*).
4. **Authentication → Sign In / Providers**: desligue **Allow new users to sign up**
   (assim só você consegue entrar).
5. **Project Settings → API**: copie a *Project URL* e a *anon public key* para `public/config.js`.
6. Faça commit e push. No iPhone, abra o app, entre com o e-mail e a senha — só na primeira vez.

Na primeira entrada, as receitas que já estavam no iPhone são enviadas para a nuvem automaticamente.

## Importar receitas (ReciMe e sites de receita)

**Dentro do app:** toque em **+** → cole o link em *Importar de um link*. O app preenche nome, ingredientes,
modo de preparo, rendimento, fonte e foto; você confere e salva.

**Direto do ReciMe (botão Compartilhar → Buttercup):** usa um Atalho do iPhone.

1. Na Vercel → projeto → **Settings → Environment Variables**, crie:
   - `BUTTERCUP_IMPORT_TOKEN` = o código que está em `.env.local` (ou qualquer senha longa)
   - `SUPABASE_SECRET_KEY` = Supabase → Project Settings → API Keys → **Secret key** (`sb_secret_…`)

   Depois: **Deployments → ⋯ → Redeploy**.
2. No iPhone, app **Atalhos** → **+**:
   - Toque no nome no topo → **Buttercup**. Em ⓘ **Detalhes**: ative **Mostrar na Folha de Compartilhamento**.
   - No topo, em "Receber **qualquer** entrada", deixe só **Texto** e **URLs**. "Se não houver entrada": **Parar e Responder**.
   - Ação **Obter Conteúdo do URL**:
     - URL: `https://SEU-APP.vercel.app/api/share`
     - Mostrar mais → Método **POST** → Corpo da Solicitação **JSON**, dois campos de texto:
       `text` = *Entrada do Atalho* · `token` = o mesmo código do passo 1
   - Ação **Mostrar Notificação** → texto: *Conteúdo do URL*.
3. No ReciMe: **Exportar/Compartilhar → Buttercup**. Aparece "🌼 … salva no Buttercup" e a receita
   já está no app na próxima vez que abrir.

## Rodar no computador

`npm run dev` serve o app e as rotas `/api` em http://localhost:4173.

## Sobre os dados

- **Com Supabase:** as receitas ficam na nuvem (com backup) e uma cópia fica no aparelho para abrir rápido
  e ler sem internet. Criar/editar precisa de internet.
- **Sem Supabase** (`config.js` vazio): tudo fica só no aparelho e some se você apagar o app da Tela de Início.
