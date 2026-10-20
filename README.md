# Biblioteca Pública Municipal de Cianorte

Sistema web em evolução para apoiar o atendimento da biblioteca. A interface React + TypeScript preserva o dashboard e as consultas demonstrativas e oferece uma área de atendimento com API Node.js e SQLite.

**Use somente registros fictícios nesta entrega.** As consultas demonstrativas mantêm os exemplos em memória e a data fixa de **13/10/2026**. A área **Atendimento com banco**, em `/#atendimento`, oferece login e registros persistidos no SQLite local. Nenhum exemplo é importado automaticamente e não há senha padrão.

O atendimento permite criar e editar leitores, obras e exemplares; registrar empréstimos com vários itens; devolver parte dos itens e renovar um exemplar por vez. Permissões, versões concorrentes e exclusividade dos empréstimos são verificadas no servidor. Alterações e circulação preservam histórico. Backup criptografado e restauração em arquivo separado são feitos pela CLI.

Consulte [a entrega operacional e suas limitações](docs/ENTREGA_OPERACIONAL.md) e [o resultado de recuperação com dados fictícios](docs/RECUPERACAO.json). A publicação Vercel existente continua sendo a demonstração: este servidor SQLite requer um processo Node.js com disco persistente e não foi publicado.

O código e as etapas estão na branch [`codex/reconstrucao-operacional`](https://github.com/rafaelcteixeira0-png/Gestao-da-Biblioteca-Municipal/tree/codex/reconstrucao-operacional). O CI aprovou 102 testes do servidor, 34 execuções de navegador, formatação, lint, tipos, build e o ensaio de persistência e recuperação em container. Consulte [os resultados e a conferência final](docs/ENTREGA_OPERACIONAL.md) e [o registro do envio](docs/ENVIO_GITHUB.md).

## Experimentar sem servidor

A opção **Atendimento** abre o [modo de teste](docs/TESTE_ATENDIMENTO.md), em `/#atendimento-teste`. Use **biblioteca.cianorte** e **BibliotecaTeste2026**. Esse acesso é um exemplo público, sem autenticação real: cadastros e circulação são simulados, ficam apenas na memória e são descartados ao recarregar ou sair da área. Use somente dados fictícios.

Para operar o SQLite com a API, abra diretamente `/#atendimento`, com uma conta criada pela CLI. O acesso público de teste não cria uma conta no banco. A integração Neon continua pendente.

## O que pode ser revisado no navegador

- Menu com Dashboard, Empréstimos, Devoluções, Renovações, Reservas, Livros, Leitores, Histórico e Relatórios.
- Indicadores calculados a partir do cenário fictício; obras e exemplares contados separadamente.
- Gráfico com seleção de período, panorama do acervo, atalhos e alertas de exemplo.
- Consultas com busca, filtros, paginação e detalhes dos registros fictícios.
- Busca global de livros e leitores; exportação de um resumo agregado fictício.
- Layout em azul, branco e cinza, menu móvel, navegação por teclado e tabelas com rolagem própria em telas estreitas.

Consulte também [o pacote de hospedagem do atendimento completo](docs/HOSPEDAGEM.md), com Docker, volume persistente e exemplo de conexão à Vercel. O servidor e o domínio ainda precisam ser definidos; a configuração de exemplo não publica serviços.

## Desenvolvimento no ambiente Codex

Requer Node.js 24+ e npm. Os comandos abaixo executam a versão local:

```bash
npm ci
npm run library -- init
npm run build
npm start
```

Abra `http://localhost:3001/#atendimento` para usar o banco local. A inicialização solicita usuário, nome e senha do primeiro administrador. Preserve o arquivo `.library-data/library.sqlite` e sua senha de backup. Não carregue planilhas ou dados pessoais nesta revisão. Para desenvolvimento com Vite e API em processos separados, veja a documentação operacional.

## Verificações

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:server
npm run build
npx playwright install chromium
npm test
```

`npm run build` inclui a verificação TypeScript. `npm run check` reúne formatação, lint, servidor, build e navegador. Os testes Playwright usam banco temporário e contas fictícias próprias; nunca reutilizam o servidor ou banco do operador. Incluem as consultas demonstrativas e os novos fluxos operacionais. A presença de um teste no repositório não significa que ele foi executado; veja os resultados registrados na documentação da entrega.

Se o ambiente já disponibilizar Chromium, é possível selecionar esse executável:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test -- --workers=2
```

Para revisar o atendimento com SQLite e autenticação, use `npm start`. `npm run preview` serve apenas a interface compilada e não inicia a API.

Para conferir apenas a interface demonstrativa compilada:

```bash
npm run build
npm run preview
```

## Organização

```text
src/
  components/   Dashboard, consultas e elementos reutilizáveis
  data/demo.ts  Cenário fictício tipado e cálculos demonstrativos
  App.tsx       Estrutura, menu, busca global e navegação
  navigation.ts Definição central do menu e rotas por fragmento
  styles.css    Layout, identidade visual e responsividade
tests/          Verificações de interface em navegador
server/         API, SQLite, autenticação e backup local
docs/           Especificação, arquitetura e roteiro de revisão
.github/        Verificações automáticas e modelo de Pull Request
```

As fontes e a ilustração são locais. A demonstração funciona sem API; o atendimento usa a API do mesmo servidor. Nenhum serviço externo foi contratado ou configurado. `package-lock.json` fixa as versões instaladas.

## Documentação e próximas etapas

- [Especificação do sistema](docs/ESPECIFICACAO_SISTEMA_BIBLIOTECA.md)
- [Plano de desenvolvimento e migração](docs/PLANO_DESENVOLVIMENTO_MIGRACAO.md)
- [Arquitetura e escopo desta entrega](docs/ARQUITETURA.md)
- [Roteiro e descrição da revisão](docs/REVISAO_PR.md)

As próximas entregas dependem da validação das regras da biblioteca, da revisão no navegador e da definição aprovada de hospedagem persistente. Prazo, limite de exemplares, multas, número máximo de renovações e reservas não são políticas institucionais aprovadas nesta implementação. O operador informa as datas de vencimento. Uso real e migração continuam pendentes; títulos repetidos são preservados e identificadores internos não se tornam tombos oficiais.
