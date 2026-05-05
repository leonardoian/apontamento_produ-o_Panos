# Sistema de Produção — Superpro
## Deploy no Netlify

### 1. Suba o projeto para o GitHub
- Crie um repositório no GitHub
- Faça upload de todos os arquivos desta pasta

### 2. Conecte ao Netlify
- Acesse app.netlify.com
- "Add new site" → "Import an existing project"
- Conecte ao repositório do GitHub

### 3. Configure as variáveis de ambiente
No Netlify: Site configuration → Environment variables → Add variable:

```
DATABASE_URL = postgresql://neondb_owner:npg_UwfyJtDlWK94@ep-empty-tree-acnvvjsm-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
JWT_SECRET   = superpro_producao_2026_secret
```

### 4. Deploy
- Build command: `npm install`
- Publish directory: `public`
- Clique em Deploy

### 5. Acesse o sistema
- URL gerada pelo Netlify (ex: https://superpro-producao.netlify.app)
- Login padrão: admin / admin123

## Estrutura
```
/
├── netlify.toml              # Config do Netlify
├── package.json              # Dependências
├── netlify/functions/
│   └── api.mjs               # API serverless (Neon + JWT)
└── public/
    ├── index.html            # Frontend completo
    └── _redirects            # Rotas Netlify
```
