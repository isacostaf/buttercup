# 🌼 Buttercup

Caderno de receitas pessoal, feito para usar no iPhone como app da Tela de Início (PWA).

HTML + CSS + JavaScript puro — sem build, sem dependências.

## Estrutura

```
public/
  index.html     metatags de PWA para iPhone
  styles.css     visual (cores, tamanhos, safe areas)
  app.js         telas: lista, receita, nova/editar
  db.js          armazenamento (IndexedDB) — único arquivo a trocar quando vier o banco de dados
  sw.js          funciona offline
  manifest.json  nome, cores e ícones do app
  icon-*.png     ícones (gerados por scripts/make-icons.mjs)
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

## Sobre os dados (importante)

Por enquanto as receitas ficam só no próprio iPhone (IndexedDB). Elas **somem** se você apagar o app da Tela de Início
ou limpar os dados de sites. O próximo passo é trocar o `db.js` por um banco (ex.: Supabase) para ter backup e sincronizar.
