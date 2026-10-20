# Atendimento de teste no navegador

Esta entrega atende ao pedido de experimentar os formulários sem salvar informações. O modo de teste funciona na interface estática da Vercel, sem API ou banco online. A implantação persistente com Neon permanece para uma etapa posterior; não foi contratada infraestrutura paga.

## Acesso público de exemplo

Abra `/#atendimento-teste` ou escolha **Atendimento** no menu.

- Usuário: **biblioteca.cianorte**
- Senha de exemplo: **BibliotecaTeste2026**

Esses valores são exemplos públicos incluídos no código e na tela. Não são credenciais de uma conta real e não protegem informações privadas. O acesso representa um perfil de atendente de demonstração. Administração de contas e troca de senha não são oferecidas nesse modo.

## O que experimentar

O teste começa com um leitor, uma obra e dois exemplares fictícios, sem tombos oficiais. Permite criar e editar leitores, obras e exemplares, buscar e filtrar registros, emprestar vários exemplares, devolver parte deles e renovar um item por vez. As movimentações aparecem no histórico temporário. As confirmações identificam as operações como simulações.

Um exemplar já emprestado fica indisponível para outro empréstimo nessa mesma instância de teste. Datas, campos obrigatórios, versões de edição e solicitações repetidas são conferidos pelo simulador. Isso ajuda a experimentar os fluxos; não representa validação no servidor nem sincronização entre usuários.

Use somente dados fictícios. O estado fica na memória da área de teste: não chama a API e não usa cookies, localStorage ou sessionStorage para guardar os registros. Recarregar a página, fechar a aba ou sair dessa área descarta o teste. Outra aba começa com seus próprios exemplos. O botão **Sair** encerra o acesso de exemplo; recarregue para reiniciar todos os registros.

O dashboard demonstrativo original continua separado. Seus números e exportações não passam a representar o que foi digitado no atendimento de teste.

## Atendimento com banco

A rota `/#atendimento` continua usando a API real, autenticação e SQLite. Ela não aceita automaticamente os exemplos públicos do modo de teste e não faz fallback para o simulador. Não existe conta padrão criada no servidor.

As funções persistentes, inclusive backup e restauração, mantêm seus testes próprios. Não há backup dos registros temporários. A integração gratuita com PostgreSQL/Neon, uma conta administrativa real e sua senha exclusiva continuam pendentes.

## Revisão local

Requer Node.js 24 ou superior.

```bash
npm ci
npm run build
npm run preview
```

Abra o endereço exibido pelo Vite e acrescente `/#atendimento-teste`. O modo de teste não depende de iniciar a API ou executar a inicialização do banco.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:server
npm run test:demo
npm run build
npx playwright install chromium
npm test
```

Os testes de navegador mantêm a fixture SQLite anterior para conferir também a área persistente. Os cenários do modo de teste verificam ausência de chamadas à API, dados descartados, isolamento entre abas, formulários, circulação e acessibilidade automatizada. Resultados executados ficam registrados em `VALIDACAO_TESTE_ATENDIMENTO.json`; a presença de um teste não comprova execução.
