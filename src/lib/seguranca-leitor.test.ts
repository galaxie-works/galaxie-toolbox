// Testes headless (sem Graph, sem DOM) do núcleo de segurança do leitor (#91).
// Rode com:  node --test src/lib/seguranca-leitor.test.ts
// (Node 24 faz type-stripping; não precisa de bundler nem framework.)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analisarLink,
  dominioRegistravel,
  hostDoTexto,
  nivelAutenticacao,
  parseAuthResults,
  replyToDivergente,
} from "./seguranca-leitor.ts";

// --- parser de Authentication-Results --------------------------------------

test("parseAuthResults: SPF/DKIM/DMARC todos pass (formato Microsoft)", () => {
  const h = [
    "spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=contoso.com; " +
      "dkim=pass (signature was verified) header.d=contoso.com; " +
      "dmarc=pass action=none header.from=contoso.com; compauth=pass reason=100",
  ];
  const r = parseAuthResults(h);
  assert.equal(r.spf, "pass");
  assert.equal(r.dkim, "pass");
  assert.equal(r.dmarc, "pass");
  assert.equal(nivelAutenticacao(r), "autenticado");
});

test("parseAuthResults: SPF fail vira nível falhou", () => {
  const r = parseAuthResults([
    "spf=fail smtp.mailfrom=evil.ru; dkim=none; dmarc=fail action=oreject header.from=banco.com",
  ]);
  assert.equal(r.spf, "fail");
  assert.equal(r.dmarc, "fail");
  assert.equal(nivelAutenticacao(r), "falhou");
});

test("parseAuthResults: dmarc=pass sobrepõe spf=fail (alinhado por DKIM)", () => {
  const r = parseAuthResults([
    "spf=fail smtp.mailfrom=bounce.example.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com",
  ]);
  assert.equal(nivelAutenticacao(r), "autenticado");
});

test("parseAuthResults: múltiplos DKIM, um pass basta", () => {
  const r = parseAuthResults([
    "dkim=fail header.d=list.example.com; dkim=pass header.d=example.com; spf=pass smtp.mailfrom=example.com",
  ]);
  assert.equal(r.dkim, "pass");
});

test("parseAuthResults: parcial quando só SPF passa (sem DKIM/DMARC)", () => {
  const r = parseAuthResults(["spf=pass smtp.mailfrom=example.com; dkim=none"]);
  assert.equal(r.spf, "pass");
  assert.equal(r.dkim, "none");
  assert.equal(r.dmarc, null);
  assert.equal(nivelAutenticacao(r), "parcial");
});

test("parseAuthResults: fallback Received-SPF quando AR não tem spf", () => {
  const r = parseAuthResults(["dkim=pass header.d=example.com"], [
    "pass (google.com: domain of a@example.com designates 1.2.3.4 as permitted sender)",
  ]);
  assert.equal(r.spf, "pass");
});

test("parseAuthResults: sem nada = indisponível", () => {
  const r = parseAuthResults([]);
  assert.equal(r.spf, null);
  assert.equal(nivelAutenticacao(r), "indisponivel");
});

test("parseAuthResults: softfail não é fail (parcial)", () => {
  const r = parseAuthResults(["spf=softfail smtp.mailfrom=example.com; dkim=none; dmarc=none"]);
  assert.equal(r.spf, "softfail");
  assert.equal(nivelAutenticacao(r), "parcial");
});

// --- domínio registrável + host do texto -----------------------------------

test("dominioRegistravel: subdomínios reduzem a eTLD+1", () => {
  assert.equal(dominioRegistravel("mail.google.com"), "google.com");
  assert.equal(dominioRegistravel("www.banco.com.br"), "banco.com.br");
  assert.equal(dominioRegistravel("a.b.c.co.uk"), "c.co.uk");
  assert.equal(dominioRegistravel("example.com"), "example.com");
});

test("hostDoTexto: reconhece URL, domínio nu e ignora texto genérico", () => {
  assert.equal(hostDoTexto("https://banco.com/login"), "banco.com");
  assert.equal(hostDoTexto("www.banco.com"), "www.banco.com");
  assert.equal(hostDoTexto("acesse paypal.com agora"), "paypal.com");
  assert.equal(hostDoTexto("clique aqui"), null);
  assert.equal(hostDoTexto("documento.pdf"), null);
});

// --- detector de mismatch / encurtador / link-safety -----------------------

test("analisarLink: mismatch texto×href (texto banco.com, href evil.ru)", () => {
  const a = analisarLink("banco.com", "https://evil.ru/login");
  assert.equal(a.mismatch, true);
  assert.equal(a.dominioTexto, "banco.com");
  assert.equal(a.dominioDestino, "evil.ru");
  assert.equal(a.suspeito, true);
  assert.ok(a.avisos.includes("mismatch"));
});

test("analisarLink: sem mismatch quando domínios batem (subdomínio ok)", () => {
  const a = analisarLink("https://mail.google.com/x", "https://accounts.google.com/signin");
  assert.equal(a.mismatch, false);
});

test("analisarLink: encurtador conhecido é sinalizado", () => {
  const a = analisarLink("Ver documento", "https://bit.ly/3xYz");
  assert.equal(a.encurtador, true);
  assert.equal(a.suspeito, true);
  assert.ok(a.avisos.includes("encurtador"));
});

test("analisarLink: host por IP", () => {
  const a = analisarLink("Confirmar", "http://192.168.10.5/pay");
  assert.equal(a.ip, true);
  assert.equal(a.inseguro, true);
  assert.ok(a.avisos.includes("ip"));
  assert.ok(a.avisos.includes("inseguro"));
});

test("analisarLink: punycode/IDN homógrafo", () => {
  const a = analisarLink("apple.com", "https://xn--80ak6aa92e.com/");
  assert.equal(a.punycode, true);
  assert.equal(a.suspeito, true);
});

test("analisarLink: redirecionamento aberto via parâmetro url=", () => {
  const a = analisarLink(
    "portal",
    "https://tracker.example.com/click?url=https://evil.ru/phish",
  );
  assert.equal(a.redirecionamento, true);
  assert.ok(a.avisos.includes("redirecionamento"));
});

test("analisarLink: link limpo https não é suspeito", () => {
  const a = analisarLink("Abrir no Outlook", "https://outlook.office365.com/mail");
  assert.equal(a.suspeito, false);
  assert.equal(a.mismatch, false);
  assert.equal(a.inseguro, false);
  assert.deepEqual(a.avisos, []);
});

test("analisarLink: href inválido não quebra", () => {
  const a = analisarLink("clique", "not a url");
  assert.equal(a.invalido, true);
  assert.equal(a.suspeito, false);
});

// --- Reply-To divergente ----------------------------------------------------

test("replyToDivergente: diferente do From é divergente", () => {
  const d = replyToDivergente("joao@proh.com.br", [{ nome: "X", email: "atacante@evil.ru" }]);
  assert.equal(d.divergente, true);
  assert.deepEqual(d.enderecos, ["atacante@evil.ru"]);
});

test("replyToDivergente: igual ao From (case-insensitive) não é divergente", () => {
  const d = replyToDivergente("Joao@Proh.com.br", [{ nome: "João", email: "joao@proh.com.br" }]);
  assert.equal(d.divergente, false);
});

test("replyToDivergente: sem Reply-To não é divergente", () => {
  const d = replyToDivergente("joao@proh.com.br", []);
  assert.equal(d.divergente, false);
});
