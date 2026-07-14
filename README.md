# Superpro — Sistema de Apontamento de Produção

Sistema web para controle de produção da **SuperPro**. Registra apontamentos por turno, calcula eficiência por operador, monitora metas mensais e gera relatórios exportáveis em Excel e PDF.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML/CSS/JS (SPA, sem framework) |
| Backend | Vercel Serverless Functions (ES Modules) |
| Banco de dados | Neon (PostgreSQL serverless) |
| Autenticação | JWT + bcryptjs |
| Gráficos | Chart.js 4.4.0 |
| Exportação | SheetJS (xlsx@0.18.5) + jsPDF@2.5.1 + jspdf-autotable |
| Deploy | Vercel |

---

## Configuração local

### Pré-requisitos

- Node.js 18+
- Conta no [Neon](https://neon.tech) com banco PostgreSQL criado
- Vercel CLI instalada globalmente: `npm i -g vercel`

### Variáveis de ambiente

Crie um arquivo `.env` na raiz com base no `.env.example`:

```env
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
JWT_SECRET=troque_por_uma_string_aleatoria_longa
```

> **Atenção:** o sistema recusa inicializar se qualquer uma dessas variáveis estiver ausente — não há fallback hardcoded.

### Rodando localmente

```bash
npm install
vercel dev
```

Acesse `http://localhost:3000`.

---

## Deploy (Vercel)

1. Conecte o repositório na [Vercel](https://vercel.com)
2. Adicione as variáveis `DATABASE_URL` e `JWT_SECRET` nas configurações do projeto
3. Deploy automático a cada push na branch `main`

---

## Estrutura do projeto

```
/
├── vercel.json              # Rotas (SPA fallback → index.html)
├── package.json
├── .env.example
├── api/
│   ├── _lib/
│   │   └── db.mjs           # Conexão Neon, helpers de auth, CORS e initDB
│   ├── login.mjs            # POST /api/login
│   ├── me.mjs               # GET /api/me
│   ├── usuarios.mjs         # CRUD de usuários
│   ├── referencias.mjs      # CRUD de referências de produtos
│   ├── programa.mjs         # Programa mensal por célula
│   ├── lancamentos.mjs      # Apontamentos (GET / POST / PUT / DELETE)
│   ├── dashboard.mjs        # KPIs e dados consolidados
│   ├── operadores.mjs       # Eficiência por operador
│   └── meses.mjs            # Meses com programa ativo
└── public/
    ├── index.html           # Aplicação principal (SPA)
    ├── style.css            # Estilos (dark theme, responsivo)
    ├── importar.html        # Importação de programa via planilha Excel
    └── favicon.svg
```

---

## Funcionalidades

### Células de trabalho

O sistema suporta múltiplas células independentes, cada uma com programa e referências próprias:

- Celular de Alumínio
- Máquina de Panos
- Máquina de Placas
- Máquina de Rodos
- Trabalho Manual
- Importação

### Dashboard

- **5 KPI cards**: Total Realizado, Meta do Mês, Atingimento (%), Eficiência Média, Total Refugo
- Comparativo meta vs. realizado por referência com barra de progresso
- Resumo por turno (T1, T2, ADM)
- Últimos lançamentos
- Referências com `meta = 0` são ocultadas automaticamente
- **Exportação para Excel** (4 abas: Resumo, Meta vs Realizado, Por Turno, Últimos Lançamentos)
- **Exportação para PDF** com tabelas formatadas

### Programa do Mês

- Listagem das referências do mês com meta, realizado por turno, total, **quantidade que falta** e percentual
- Referências com `meta = 0` são ocultadas
- **Alerta visual**: linhas com menos de 60% de atingimento nos últimos 10 dias do mês ficam em destaque vermelho com ícone ⚠
- Exclusão de referência do programa (admin)
- Adição de referência ao programa (admin)

### Lançamento de Produção

- Formulário com busca de referência por código ou descrição (dropdown filtrado)
- Turno: **T1**, **T2** ou **ADM**
- Campo **Operador** preenchido automaticamente com o usuário logado (readonly)
- Eficiência calculada automaticamente com base nas horas trabalhadas e meta/hora
- **Toast de confirmação** ao salvar (verde) ou erro (vermelho)
- **Painel "Seus lançamentos de hoje"**: exibe os últimos lançamentos do dia do usuário abaixo do formulário após cada salvamento

### Histórico

- Filtros por célula, mês, turno e referência
- Listagem com data, turno, referência, operador, realizado, meta, refugo, eficiência, horários e obs
- **Admin**: botão de edição (✎) que abre modal para corrigir qualquer campo do lançamento
- **Admin**: botão de exclusão (✕) com confirmação

### Gráficos por Célula

- Gráfico de rosca (doughnut) por célula mostrando atingimento do mês
- Exibe: Meta Total, Realizado, Eficiência Média e percentual de Atingimento

### Relatório de Operadores

- Ranking de produção por operador no mês
- Filtro por célula
- Colunas: Matrícula, Nome, Total Realizado, Lançamentos, Eficiência Média, Realizado T1/T2/ADM, Refugo
- **Exportação para Excel e PDF**

### Referências (admin)

- Cadastro de novas referências com código, descrição, célula e meta hora
- Listagem com busca por código ou descrição
- Edição inline de meta hora e célula
- **Exclusão em lote**: seleção múltipla via checkbox com botão "Apagar selecionadas"

### Usuários (admin)

- Cadastro de usuários com login, senha, nome e perfil (operador/admin)
- Listagem e exclusão (exceto o usuário `admin`)

### Importação de planilha

Acesse `/importar.html` para importar programas mensais via `.xlsx`.

A planilha deve conter as colunas: `MÊS/ANO`, `CELULA`, `COD_REF`, meta por turno e número de turnos.

> Para meses com apenas turno ADM, use `Nº DE TURNOS = 1` — a meta total será `Meta/Turno × 1`.

### Interface

- Dark theme com variáveis CSS customizadas
- Crédito de desenvolvimento visível na tela de login (canto inferior direito)
- **Responsivo para mobile**: sidebar colapsável com botão hamburguer, formulários em coluna única
- Sidebar fecha automaticamente ao navegar em dispositivos móveis
- **Toasts**: notificações animadas de sucesso, erro e informação no canto inferior direito

---

## Cálculo de eficiência

```
Eficiência = Realizado ÷ (Meta/hora × Horas trabalhadas)
```

Se `hora_inicio` e `hora_fim` não forem preenchidos, o sistema usa a meta do turno como fallback. O turno ADM entra no cálculo exatamente como T1 e T2.

---

## Banco de dados

As tabelas são criadas automaticamente na primeira requisição via `initDB()`.

### `usuarios`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `login` | VARCHAR | Login único |
| `nome` | VARCHAR | Nome completo |
| `senha_hash` | TEXT | Senha com bcrypt |
| `perfil` | VARCHAR | `admin` ou `operador` |
| `ativo` | BOOLEAN | Soft-delete |

### `referencias`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `cod` | VARCHAR | Código único (ex: SP2745LR) |
| `descricao` | TEXT | Descrição do produto |
| `meta_hora` | INT | Meta de peças/hora (opcional) |
| `celula` | VARCHAR | Célula padrão (default: `Panos`) |
| `ativo` | BOOLEAN | Soft-delete |

### `programa`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `mes_ano` | VARCHAR | Formato `YYYY-MM` |
| `ref_cod` | VARCHAR | Código da referência |
| `celula` | VARCHAR | Célula/Setor |
| `meta_turno` | INT | Meta de peças por turno |
| `num_turnos` | INT | Número de turnos planejados no mês |
| `ativo` | BOOLEAN | Soft-delete |

> Constraint única: `(mes_ano, ref_cod, celula)`

### `lancamentos`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | SERIAL PK | |
| `data` | DATE | Data do apontamento |
| `turno` | VARCHAR | `T1`, `T2` ou `ADM` |
| `ref_cod` | VARCHAR | Referência |
| `descricao` | VARCHAR | Descrição (desnormalizada para histórico) |
| `operador` | VARCHAR | Nome do operador |
| `realizado` | INT | Peças realizadas |
| `meta` | INT | Meta de peças no momento do lançamento |
| `refugo` | INT | Peças refugadas |
| `eficiencia` | NUMERIC(6,4) | Eficiência calculada (0.0 – 1.0+) |
| `hora_inicio` | VARCHAR | Hora de início |
| `hora_fim` | VARCHAR | Hora de fim |
| `obs` | TEXT | Observações |
| `usuario_login` | VARCHAR | Login de quem registrou |
| `criado_em` | TIMESTAMP | Timestamp automático |

---

## API

Todos os endpoints requerem o header `Authorization: Bearer <token>`, exceto `/api/login`.

### Autenticação

```
POST /api/login
Body: { "login": "user", "senha": "pass" }
Response: { "token": "...", "usuario": { "login", "nome", "perfil" } }
```

### Usuário logado

```
GET /api/me
```

### Referências

```
GET    /api/referencias
POST   /api/referencias
Body:  { "cod": "SP2745LR", "descricao": "...", "celula": "Panos", "meta_hora": 80 }
DELETE /api/referencias
Body:  { "cod": "SP2745LR" }
```

### Programa mensal

```
GET    /api/programa?mes=2026-06&celula=Panos
POST   /api/programa          (admin)
Body:  { "mes_ano": "2026-06", "ref_cod": "SP2745LR", "celula": "Panos", "meta_turno": 80, "num_turnos": 2 }
DELETE /api/programa          (admin)
Body:  { "mes_ano": "2026-06", "ref_cod": "SP2745LR", "celula": "Panos" }
```

### Lançamentos

```
GET    /api/lancamentos?mes=2026-06&celula=Panos[&turno=T1][&ref=SP2745LR]
POST   /api/lancamentos
Body:  { "data": "2026-06-24", "turno": "T1", "ref_cod": "SP2745LR",
         "operador": "João Silva", "realizado": 80, "meta": 80, "refugo": 0,
         "hora_inicio": "08:00", "hora_fim": "09:00", "obs": "", "eficiencia": 1.0 }
PUT    /api/lancamentos       (admin)
Body:  { "id": 123, "data": "2026-06-24", "turno": "T1", "realizado": 80,
         "refugo": 0, "hora_inicio": "08:00", "hora_fim": "09:00", "obs": "", "eficiencia": 1.0 }
DELETE /api/lancamentos       (admin)
Body:  { "id": 123 }
```

### Dashboard

```
GET /api/dashboard?mes=2026-06[&celula=Panos]
Response: { totais, prog, turnos, recentes }
```

### Operadores

```
GET /api/operadores?mes=2026-06[&celula=Panos]
```

### Meses disponíveis

```
GET /api/meses
Response: ["2026-07", "2026-06", ...]
```
