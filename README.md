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
supabase/schema.sql   tabela e regras de segurança
vercel.json      publica a pasta public/
```

## Rodar no computador

```bash
npm run dev
```

Abre em http://localhost:4173.

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

## Sobre os dados

- **Com Supabase:** as receitas ficam na nuvem (com backup) e uma cópia fica no aparelho para abrir rápido
  e ler sem internet. Criar/editar precisa de internet.
- **Sem Supabase** (`config.js` vazio): tudo fica só no aparelho e some se você apagar o app da Tela de Início.
