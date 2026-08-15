/* ---------------------------------------------------------------------------
 * TudoAzul / Azul Viagens — hotéis — passageiros + ida para a tela de cupom
 *
 * USO PRINCIPAL — cole no console da TELA DE RESULTADOS, logado:
 *   1. o painel lê o results.ashx da sessão — de lá saem as tarifas (com
 *      pontos/preço), a data de check-in e o `distribution` da busca, que
 *      diz quantos adultos/crianças/bebês preencher;
 *   2. você escolhe o hotel + a tarifa num dropdown agrupado por hotel;
 *   3. informa os CPFs — ele consulta o cadastro e preenche o que voltar;
 *   4. "Reservar" dispara os dois POSTs em sequência: POST 1 (UID +
 *      optionID) seleciona a tarifa na sessão, POST 2 (action=book) cria a
 *      reserva e navega para confirmBooking.aspx, onde fica o cupom.
 *
 * Também funciona se você já estiver na booking.aspx:
 *   - com o formulário de passageiros renderizado → preenche o form real;
 *   - com "Pontos Insuficientes" e sem formulário → mesmo caminho de dois
 *     POSTs, pegando UID/optionID da própria página.
 *
 * Em todos os casos consulta o CPF em /booking/handlers/getHolderInfo.ashx
 * (o mesmo request do link "Validar CPF") e, se não houver cadastro, aceita
 * os dados digitados à mão.
 *
 * NÃO CONFIRMA RESERVA — para na tela de confirmação/cupom.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var VERSION = '1.4.1';
  var KOFI = 'https://ko-fi.com/eduoct';

  // Só monta a UI no site certo. Fora daqui, sai sem tocar na página.
  var HOST_OK = /(^|\.)azulviagens\.com\.br$/i.test(window.location.hostname);
  var PAGE_OK = /\/(results|booking)\.aspx/i.test(window.location.pathname);
  if (!HOST_OK || !PAGE_OK) {
    alert('Reserva TudoAzul v' + VERSION + '\n\n' +
          'Este atalho só funciona na busca de hotéis do TudoAzul / Azul Viagens.\n\n' +
          'Faça a busca, e na TELA DE RESULTADOS (results.aspx), já logado, clique no favorito.');
    return;
  }

  // Opcional: documentos na ordem dos paxes. 🔴 Não commitar preenchido.
  var PRESET_DOCS = [];

  var $ = window.jQuery;
  if (!$) { alert('jQuery não encontrado — está na página do TudoAzul?'); return; }

  var TYPE_LABEL = { '0': 'Adulto', '1': 'Criança', '2': 'Bebê' };
  var HANDLER = '/booking/handlers/getHolderInfo.ashx';
  var TITLES_ADULT = [{ value: 'MR', text: 'Sr.' }, { value: 'MRS', text: 'Sra.' }];
  var TITLES_CHILD = [{ value: 'MSTR', text: 'Criança (M)' }, { value: 'MISS', text: 'Criança (F)' }];

  // ---------------------------------------------------------------- helpers
  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  function maskCPF(s) {
    var d = digits(s);
    return d.length === 11
      ? d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9)
      : s;
  }

  function parseBR(str) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(str || '').trim());
    if (!m) return null;
    var d = new Date(+m[3], +m[2] - 1, +m[1]);
    return isNaN(d) ? null : d;
  }

  function ageAt(birthStr, refStr) {
    var b = parseBR(birthStr), r = parseBR(refStr);
    if (!b || !r) return null;
    var a = r.getFullYear() - b.getFullYear();
    var pre = r.getMonth() < b.getMonth() ||
              (r.getMonth() === b.getMonth() && r.getDate() < b.getDate());
    return pre ? a - 1 : a;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function brDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  function qsParam(name, href) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(href || window.location.href);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // ----------------------------------------------- aviso de cookies do site
  // 🔴 NÃO gravar cookie aqui. A v1.0.6 gravava `accept-cookies` duas vezes
  // (host-only + domain=.azulviagens.com.br). O navegador passou a mandar o
  // par duplicado no header de toda requisição e o site quebrou com
  // ERR_HTTP2_PROTOCOL_ERROR. O ganho era esconder uma tarja; o custo foi o
  // site inteiro. Aqui só desfazemos aquilo e escondemos a tarja na marra.
  function limparCookieDuplicado() {
    var morto = '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    var tinha = (document.cookie.match(/accept-cookies=/g) || []).length;
    if (tinha > 1) {
      try {
        document.cookie = 'accept-cookies' + morto + '; domain=.azulviagens.com.br';
        document.cookie = 'accept-cookies' + morto + '; domain=' + window.location.hostname;
        document.cookie = 'accept-cookies' + morto;
      } catch (e) { /* nada a fazer */ }
    }
    return { tinha: tinha, restou: (document.cookie.match(/accept-cookies=/g) || []).length };
  }

  // O jeito certo é usar o botão do próprio site. O base.min.js faz:
  //   $('.cookie-policy__close').on('click', function () {
  //     Cookies.set('accept-cookies', true, { path: '/', expires: 365 });
  //     $(this).closest('.cookie-policy').fadeOut();
  //   });
  // ou seja: o site JÁ grava por 365 dias. Minha premissa de que ele gravava
  // sem expiração estava errada. Então aqui a gente só dispara o clique dele —
  // e só grava o cookie na mão se o botão não existir (fallback), com a guarda
  // de nunca deixar mais de um `accept-cookies` (foi a duplicata que derrubou
  // o site na v1.0.6).
  // 🔴 O buscador do site exige esse cookie: sem ele, a busca é bloqueada com
  // "you must accept cookies to be able to search" (js_searcher).
  function aceitarPeloSite() {
    var $btn = $('.cookie-policy__close:visible').first();
    if (!$btn.length) $btn = $('.cookie-policy__close').first();

    // sem o botão conhecido, procura um "aceitar/entendi/ok" dentro da tarja
    if (!$btn.length) {
      acharTarjas().forEach(function (a) {
        if ($btn.length) return;
        $(a.el).find('button, a, [role=button]').each(function () {
          if ($btn.length) return;
          var t = ($(this).text() || '').trim().toLowerCase();
          if (/aceit|concord|entendi|^ok$|prossegu|continuar/.test(t)) $btn = $(this);
        });
      });
    }
    if (!$btn.length) return false;
    state.aceiteClicado = ($btn.attr('class') || $btn.prop('tagName') || '?').toString().slice(0, 60);
    try { $btn.trigger('click'); } catch (e) { return false; }
    return (document.cookie.match(/accept-cookies=/g) || []).length === 1;
  }

  function fixarAceite() {
    function quantos() { return (document.cookie.match(/accept-cookies=/g) || []).length; }
    var antes = quantos();
    if (antes > 1) return { ok: false, motivo: 'já havia duplicata (limpe os cookies do site)' };

    var venc = new Date();
    venc.setFullYear(venc.getFullYear() + 1);
    var attrs = '; path=/; expires=' + venc.toUTCString() + '; SameSite=Lax';
    try { document.cookie = 'accept-cookies=true' + attrs; }
    catch (e) { return { ok: false, motivo: e.message }; }

    var depois = quantos();
    if (depois > 1) {                           // passou de UM: desfaz JÁ
      try { document.cookie = 'accept-cookies=' + attrs.replace(/expires=[^;]+/, 'expires=Thu, 01 Jan 1970 00:00:00 GMT'); }
      catch (e) { /* segue */ }
      return { ok: false, motivo: 'gravar duplicaria o cookie — desfeito' };
    }
    return { ok: quantos() === 1, motivo: '' };
  }

  // esconde a tarja só nesta visualização — sem tocar em cookie nenhum
  // A tarja nem sempre se chama "cookie": pode ser consent, lgpd, privacidade.
  // Além de esconder, guardamos QUAIS elementos casaram, porque quando o aviso
  // volta mesmo com o cookie salvo é sinal de que ele não é o que eu penso.
  var SELETOR_TARJA = '[class*="cookie" i],[id*="cookie" i],[class*="consent" i],' +
                      '[id*="consent" i],[class*="lgpd" i],[id*="lgpd" i],' +
                      '[class*="privacid" i],[id*="privacid" i]';

  function acharTarjas() {
    var achados = [];
    $(SELETOR_TARJA).each(function () {
      var el = this;
      if (panel && (el === panel || $.contains(panel, el))) return;
      var st = window.getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'sticky') return;
      if (st.display === 'none' || st.visibility === 'hidden') return;
      achados.push({
        el: el,
        desc: (el.tagName || '?').toLowerCase() +
              (el.id ? '#' + el.id : '') +
              (el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '') +
              ' [' + st.position + ']'
      });
    });
    return achados;
  }

  function esconderTarjaCookies() {
    var achados = acharTarjas();
    state.tarjas = achados.map(function (a) { return a.desc; });
    achados.forEach(function (a) { $(a.el).hide(); });
    return achados.length;
  }

  // ------------------------------------------- padrão de passageiros salvo
  // Guarda os pax que você já usou (localStorage do próprio tudoazul) e
  // repõe automaticamente nas buscas seguintes. São os mesmos dados que o
  // site já tem no cadastro — mas é dado pessoal: use "Limpar padrão" no
  // painel se for usar um navegador que não é seu.
  var PRESET_KEY = 'azulPaxPreset.v1';

  function loadPreset() {
    try { return JSON.parse(window.localStorage.getItem(PRESET_KEY) || 'null') || null; }
    catch (e) { return null; }
  }

  function savePreset() {
    var list = state.paxes
      .filter(function (p) { return p.name || p.doc; })
      .map(function (p) {
        return {
          type: p.type, doc: p.doc, docKind: p.docKind, name: p.name,
          surname: p.surname, birthday: p.birthday, treatment: p.treatment, ffp: p.ffp
        };
      });
    if (!list.length) { log('nada preenchido para salvar.'); return; }
    try {
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(list));
      log('✅ padrão salvo: ' + list.map(function (p) { return p.name || p.doc; }).join(', ') +
          '.\nDa próxima vez ele volta sozinho.');
    } catch (e) { log('❌ não consegui salvar: ' + e.message); }
  }

  function clearPreset() {
    try { window.localStorage.removeItem(PRESET_KEY); log('padrão apagado deste navegador.'); }
    catch (e) { log('❌ ' + e.message); }
  }

  // repõe o padrão nas linhas vazias — casa adulto com adulto, criança com criança
  var hydrateInfo = { preset: 0, presetComDoc: 0, aplicados: 0, comDoc: 0 };

  function hydrate(rows) {
    var preset = loadPreset();
    hydrateInfo.preset = preset ? preset.length : 0;
    hydrateInfo.presetComDoc = preset ? preset.filter(function (p) { return !!p.doc; }).length : 0;
    if (!preset || !preset.length) return rows;
    var usados = {};

    rows.forEach(function (p, i) {
      if (p.name || p.doc) return;                       // já preenchido, não mexe
      var alvo = null;
      // 1º tenta a mesma posição, se o tipo bater
      if (preset[i] && !usados[i] && String(preset[i].type) === String(p.type)) alvo = i;
      // senão, o primeiro do mesmo tipo ainda não usado
      if (alvo === null) {
        for (var j = 0; j < preset.length; j++) {
          if (!usados[j] && String(preset[j].type) === String(p.type)) { alvo = j; break; }
        }
      }
      if (alvo === null) return;
      usados[alvo] = true;
      var src = preset[alvo];
      p.doc = src.doc || ''; p.docKind = src.docKind || 'cpf';
      p.name = src.name || ''; p.surname = src.surname || '';
      p.birthday = src.birthday || ''; p.ffp = src.ffp || '';
      if (src.treatment && p.titles.some(function (t) { return t.value === src.treatment; })) {
        p.treatment = src.treatment;
      }
      p.comId = digits(p.doc);
      p.status = 'padrão';
      hydrateInfo.aplicados++;
      if (p.doc) hydrateInfo.comDoc++;
    });
    return rows;
  }

  // o que o padrão fez — em texto, pra não ter que adivinhar
  function resumoPreset() {
    if (!hydrateInfo.preset) return 'nenhum padrão salvo neste navegador.';
    return 'padrão: ' + hydrateInfo.preset + ' pax salvos (' + hydrateInfo.presetComDoc +
           ' com documento) · aplicados agora: ' + hydrateInfo.aplicados +
           ' (' + hydrateInfo.comDoc + ' com documento)' +
           (hydrateInfo.preset && !hydrateInfo.aplicados
             ? '\n⚠️ nada foi aplicado — o tipo dos pax salvos não bate com o da busca atual.'
             : '');
  }

  // ------------------------------------------------------- modelo de pax
  function newPax(o) {
    return $.extend({
      $row: null, room: 1, type: '0', typeLabel: 'Adulto', age: 30,
      tripDate: '', adultAgeFrom: 18, label: '', titles: TITLES_ADULT,
      ageIncerta: false,
      doc: '', docKind: 'cpf', name: '', surname: '', birthday: '',
      treatment: '', ffp: '', comId: '', cpfFromFFP: '', status: 'pendente'
    }, o);
  }

  // lê as linhas de pax de um documento (a página atual ou o HTML do POST 1)
  function readPaxRows(root, live) {
    var $root = $(root);
    var rows = $root.find('.js-booking-paxes-pax-row');
    return rows.map(function (i, el) {
      var $row = $(el);
      var type = String($row.attr('data-pax-type'));
      var titles = $row.find('[name=pax-treatment] option').map(function () {
        return { value: this.value, text: $(this).text().trim() };
      }).get();
      return newPax({
        $row: live ? $row : null,
        room: $row.closest('.booking-paxes__room').attr('data-roomnumber') || 1,
        type: type,
        typeLabel: TYPE_LABEL[type] || 'Pax',
        age: parseInt($row.attr('data-pax-age'), 10),
        tripDate: $row.attr('data-pax-tripdate') || '',
        adultAgeFrom: parseInt($row.attr('data-pax-adultagefrom'), 10) || 18,
        label: $row.find('.booking-paxes__pax-type').text().replace(/\s+/g, ' ').trim(),
        titles: titles.length ? titles : (type === '0' ? TITLES_ADULT : TITLES_CHILD),
        treatment: (titles[0] || {}).value || (type === '0' ? 'MR' : 'MSTR')
      });
    }).get();
  }

  // lê a composição direto da barra de busca da tela de resultados
  // (.room-selector guarda o JSON de quartos/adultos/crianças/bebês)
  function readSearchBarPaxes() {
    var raw = null;

    // 1) o JSON que o widget guarda
    $('.room-selector[data-room-selector-data]').each(function () {
      if (raw) return;
      try {
        var j = JSON.parse($(this).attr('data-room-selector-data'));
        if (j && j.length) raw = j;
      } catch (e) { /* tenta o próximo */ }
    });

    // 2) os selects vivos da barra (quando o JSON não está lá)
    if (!raw) {
      var $w = $('.room-selector').first();
      var $ad = ($w.length ? $w : $(document)).find('.js-adults-selector');
      if ($ad.length) {
        raw = [];
        $ad.each(function () {
          var $room = $(this).closest('.room-fields');
          if (!$room.length) $room = $(this).parent().parent();
          var nA = parseInt($(this).val(), 10) || 0;
          var nC = parseInt($room.find('.js-children-selector').val(), 10) || 0;
          var nB = parseInt($room.find('.js-babies-selector').val(), 10) || 0;
          var ages = $room.find('select.age[data-pax-type-label=children]').map(function () {
            return parseInt($(this).val(), 10);
          }).get().filter(function (a) { return !isNaN(a); });
          raw.push({
            adults: Array.apply(null, Array(nA)).map(function () { return { age: 30 }; }),
            children: Array.apply(null, Array(nC)).map(function (_, i) { return { age: ages[i] != null ? ages[i] : 5 }; }),
            babies: Array.apply(null, Array(nB)).map(function () { return { age: 1 }; })
          });
        });
        if (!raw.some(function (r) { return r.adults.length; })) raw = null;
      }
    }

    // 3) último recurso: o resumo textual ("1 Quartos 2 adulto(s) 2 criança(s)")
    if (!raw) {
      var txt = $('.search-summary__paxes').first().text().replace(/\s+/g, ' ');
      var mA = /(\d+)\s*adulto/i.exec(txt), mC = /(\d+)\s*(criança|crianc|child)/i.exec(txt);
      if (mA) {
        raw = [{
          adults: Array.apply(null, Array(+mA[1])).map(function () { return { age: 30 }; }),
          children: Array.apply(null, Array(mC ? +mC[1] : 0)).map(function () { return { age: 5 }; }),
          babies: []
        }];
      }
    }

    if (!raw) return [];

    var out = [];
    raw.forEach(function (room, ri) {
      var n = ri + 1;
      function push(list, type, defAge) {
        (list || []).forEach(function (p, i) {
          var age = p && p.age != null ? p.age : defAge;
          out.push(newPax({
            room: n, type: type, typeLabel: TYPE_LABEL[type], age: age,
            titles: type === '0' ? TITLES_ADULT : TITLES_CHILD,
            treatment: type === '0' ? 'MR' : 'MSTR',
            label: TYPE_LABEL[type] + ' ' + (i + 1) +
                   (type === '0' ? '' : ' (' + age + ' ano(s))') +
                   (raw.length > 1 ? ' · quarto ' + n : '')
          }));
        });
      }
      push(room.adults, '0', 30);
      push(room.children, '1', 5);
      push(room.babies, '2', 1);
    });
    return hydrate(out);
  }

  // traz o que já foi digitado para as linhas que o servidor devolveu
  function mergeTyped(serverRows, typed) {
    serverRows.forEach(function (p, i) {
      var t = typed[i];
      if (!t) return;
      ['doc', 'docKind', 'name', 'surname', 'birthday', 'ffp', 'comId', 'cpfFromFFP', 'status']
        .forEach(function (k) { if (t[k]) p[k] = t[k]; });
      if (t.treatment && p.titles.some(function (x) { return x.value === t.treatment; })) {
        p.treatment = t.treatment;
      }
    });
    return serverRows;
  }

  // --------------------------------------------- consulta do titular (CPF)
  async function lookup(pax) {
    var id = digits(pax.doc);
    if (!id) throw new Error('documento vazio');

    var res = await fetch(HANDLER + '?_=' + Date.now() + '&id=' + encodeURIComponent(id), {
      credentials: 'same-origin',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    var txt = await res.text(), data;
    try { data = JSON.parse(txt); }
    catch (e) { throw new Error('resposta não-JSON (sessão caiu ou Akamai barrou)'); }

    if (!data || data.ErrorData || !data.Name) throw new Error('sem cadastro');
    return data;
  }

  // ------------------------------------------- refs da tarifa (UID/optionID)
  function detectRefs() {
    var d = window.$jbe && $jbe.booking1 && $jbe.booking1.options && $jbe.booking1.options.data;
    if (d && d.UID && d.optionID) return { UID: d.UID, optionID: d.optionID, from: '$jbe.booking1' };

    var m = /"UID"\s*:\s*"([^"]+)"[\s\S]{0,400}?"optionID"\s*:\s*"([^"]+)"/
      .exec(document.documentElement.innerHTML);
    if (m) return { UID: m[1], optionID: m[2], from: 'script inline' };

    return null;
  }

  // Catálogo vindo do results.ashx — mesma fonte do v3. Traz optionID, pontos,
  // preço, a data de check-in e o `distribution` (a composição real da busca).
  function catalogoDoResultado(res) {
    var h = res.hotel || {}, av = res.availability || {};
    return (av.options || []).map(function (o) {
      var red = o.priceDetail && o.priceDetail.LoyaltyRules &&
                o.priceDetail.LoyaltyRules.redemption;
      var c = {
        hotel: h.name,
        uid: h.UID || (h.GUID || '').replace('HOT:', ''),
        optionID: o.ID,
        quarto: (o.roomList && o.roomList[0] ? o.roomList[0].name : '') || 'opção',
        pensao: o.boardTypeName || o.boardCode || '',
        preco: o.price,
        moeda: o.currency,
        pontos: red ? red.points.pointsTotalAmount : null,
        semReemb: !!o.nonRefundable,
        dist: av.distribution,
        checkin: av.startDate
      };
      c.label = c.quarto + (c.pensao ? ' · ' + c.pensao : '') + ' · ' +
                (c.pontos != null ? c.pontos.toLocaleString('pt-BR') + ' pts'
                                  : c.moeda + ' ' + c.preco) +
                (c.semReemb ? ' · sem reemb.' : '');
      return c;
    });
  }

  async function pedirPagina(sid, page) {
    var qs = '?searchSessionID=' + encodeURIComponent(sid) + (page > 1 ? '&page=' + page : '');
    var urls = ['/hotels/ashx/results.ashx' + qs, '/hotels/handlers/results.ashx' + qs];
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i], {
          credentials: 'same-origin',
          headers: { 'x-requested-with': 'XMLHttpRequest' }
        });
        if (!r.ok) continue;
        var t = await r.text();
        if (t.trim().charAt(0) === '{') return JSON.parse(t);
      } catch (e) { /* tenta o próximo */ }
    }
    return null;
  }

  // O results.ashx é PAGINADO (summary.page / resultPerPage / totalResults).
  // Pegar só a primeira página deixava o dropdown incompleto quando a busca
  // tinha mais hotéis do que cabe numa página — que é o caso de "carregar
  // mais" na tela. Aqui varremos todas as páginas de uma vez, na abertura.
  async function loadCatalog() {
    var sid = qsParam('searchSessionID') ||
              (/searchSessionID=(\d+)/.exec(window.location.hash) || [])[1];
    if (!sid) return null;

    var json = await pedirPagina(sid, 1);
    if (!json || !json.results) return null;

    var sum = json.summary || {};
    var perPage = parseInt(sum.resultPerPage, 10) || json.results.length || 12;
    var total = parseInt(sum.totalResults, 10) || json.results.length;
    var paginas = Math.max(1, Math.min(Math.ceil(total / perPage), 25));   // teto de segurança
    var brutos = json.results.slice();

    for (var pg = 2; pg <= paginas; pg++) {
      await sleep(250);                     // sem martelar o handler
      var jn = await pedirPagina(sid, pg);
      if (!jn || !jn.results || !jn.results.length) break;
      brutos = brutos.concat(jn.results);
    }
    state.paginas = paginas;
    state.hoteisTotal = total;

    var cat = [];
    brutos.forEach(function (res) { cat = cat.concat(catalogoDoResultado(res)); });
    return cat.length ? cat : null;
  }

  // O results.ashx só devolve as primeiras opções de cada hotel. O botão "+"
  // da tela chama options.ashx com o optionID da primeira opção e recebe a
  // lista completa daquele hotel:
  //   $.post(handlers.moreOptions, { optionID: options[0].ID, searchSessionID })
  //     .done(s => cache.items[uid].availability = s.results[0].availability)
  async function opcoesDoHotel(sid, primeiroOptionID) {
    var body = 'optionID=' + encodeURIComponent(primeiroOptionID) +
               '&searchSessionID=' + encodeURIComponent(sid);
    var urls = ['/hotels/ashx/options.ashx', '/hotels/handlers/options.ashx'];
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i], {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/x-www-form-urlencoded',
                     'x-requested-with': 'XMLHttpRequest' },
          body: body
        });
        if (!r.ok) continue;
        var t = await r.text();
        if (t.trim().charAt(0) !== '{') continue;
        var j = JSON.parse(t);
        var res = j.results && j.results[0];
        if (res && res.availability) return res;
      } catch (e) { /* tenta o próximo */ }
    }
    return null;
  }

  // completa o catálogo hotel a hotel, e vai redesenhando conforme chega
  async function completarTarifas(sid) {
    if (!state.catalog) return;
    var porHotel = {}, ordem = [];
    state.catalog.forEach(function (c) {
      if (!porHotel[c.uid]) { porHotel[c.uid] = c; ordem.push(c.uid); }
    });

    state.completando = { feitos: 0, total: ordem.length };
    render();

    for (var i = 0; i < ordem.length; i++) {
      var base = porHotel[ordem[i]];
      var res = await opcoesDoHotel(sid, base.optionID);
      if (res) {
        var novos = catalogoDoResultado(res).filter(function (n) {
          return !state.catalog.some(function (c) { return c.optionID === n.optionID; });
        });
        if (novos.length) {
          // entra logo depois das opções que já existiam daquele hotel
          var ultimo = -1;
          state.catalog.forEach(function (c, idx) { if (c.uid === base.uid) ultimo = idx; });
          state.catalog.splice.apply(state.catalog, [ultimo + 1, 0].concat(novos));
        }
      }
      state.completando.feitos = i + 1;
      render();
      await sleep(200);
    }
    state.completando = null;
    render();
    log('lista completa: ' + state.catalog.length + ' tarifas em ' + ordem.length + ' hotéis.');
  }

  // composição da busca segundo o próprio motor (availability.distribution)
  // ⚠️ O `distribution` traz só a CONTAGEM de crianças, não as idades. Inventar
  // idade aqui manda para o motor um pax que ele não cotou — e ele responde
  // HTTP 500. Então marcamos como incerta e pedimos no painel.
  function paxesFromDistribution(d) {
    if (!d) return [];
    var out = [];
    function push(n, type, defAge, incerta) {
      for (var i = 0; i < (n || 0); i++) {
        out.push(newPax({
          room: 1, type: type, typeLabel: TYPE_LABEL[type], age: defAge,
          ageIncerta: !!incerta,
          titles: type === '0' ? TITLES_ADULT : TITLES_CHILD,
          treatment: type === '0' ? 'MR' : 'MSTR',
          label: TYPE_LABEL[type] + ' ' + (i + 1)
        }));
      }
    }
    push(d.adults, '0', 30, false);        // adulto é 30 no site, sempre
    push(d.children, '1', null, true);
    push(d.babies, '2', null, true);
    return hydrate(out);
  }

  // hotéis + tarifas visíveis na tela de resultados (fallback do catálogo)
  // posição de cada tarifa na tela, para o dropdown seguir o que você vê
  function ordemDaTela() {
    var pos = {}, n = 0;
    $('.result[data-uid]').each(function () {
      var uid = $(this).attr('data-uid');
      $(this).find('[data-option-id]').each(function () {
        pos[uid + '|' + $(this).attr('data-option-id')] = n++;
      });
    });
    return pos;
  }

  function listResultOptions() {
    if (state.catalog) {
      var pos = ordemDaTela();
      state.casadosNoDom = Object.keys(pos).length;
      var lista = state.catalog.map(function (c, i) {
        var k = pos[c.uid + '|' + c.optionID];
        return {
          uid: c.uid, hotel: c.hotel, optionID: c.optionID, label: c.label, _cat: c,
          _ord: k === undefined ? 1e6 + i : k,     // fora da tela vai para o fim
          _naTela: k !== undefined
        };
      });
      lista.sort(function (a, b) { return a._ord - b._ord; });
      return lista;
    }
    return $('.result[data-uid]').map(function () {
      var $r = $(this);
      var uid = $r.attr('data-uid');
      var nome = $r.find('.info-card__image-holder[data-title]').first().attr('data-title') ||
                 $r.find('[data-title]:not([data-toggle])').first().attr('data-title') ||
                 $r.find('.info-card__title, h2, h3').first().text().replace(/\s+/g, ' ').trim() ||
                 uid;
      return $r.find('[data-option-id]').map(function (i) {
        var $o = $(this);
        var preco = $o.find('.result-option__price').first().text().replace(/\s+/g, ' ').trim();
        var quarto = $o.find('.result-option__title, .result-option__name').first()
                       .text().replace(/\s+/g, ' ').trim();
        return {
          uid: uid,
          hotel: nome,
          optionID: $o.attr('data-option-id'),
          label: (quarto || 'opção ' + (i + 1)) + (preco ? ' · ' + preco : '')
        };
      }).get();
    }).get();
  }

  function bookingUrl(uid) {
    if (/booking\.aspx/i.test(window.location.pathname)) return window.location.href;
    var sid = qsParam('searchSessionID');
    // formato do v3 (o que comprovadamente passou): separadores já escapados
    // e o UID com UM encode só — %40, não %2540.
    var hash = 'order%3DetiquetaPrecio%26__scrollToUID%3D' + encodeURIComponent(uid);
    return '/hotels/booking.aspx?searchSessionID=' + encodeURIComponent(sid) + '&hashParams=' + hash;
  }

  // POST 1: seleciona a tarifa na sessão e devolve o HTML da booking
  async function selectFare(refs) {
    var res = await fetch(bookingUrl(refs.UID), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'UID=' + encodeURIComponent(refs.UID) + '&optionID=' + encodeURIComponent(refs.optionID)
    });
    if (!res.ok) throw new Error('POST 1 devolveu HTTP ' + res.status);
    return await res.text();
  }

  // O POST 1 pode voltar: o formulário, o aviso de pontos (que é OK seguir),
  // ou a página de erro genérica do site — que significa sessão/tarifa morta.
  // Antes eu seguia em frente em todos os casos e o POST 2 caía no mesmo erro.
  function classifyBooking(doc, html) {
    if ($(doc).find('.js-booking-paxes-pax-row').length) return 'form';

    var txt = ($(doc).find('body').text() || '').replace(/\s+/g, ' ').toLowerCase();
    if (/desculpe-nos|erro inesperado|houve um erro/.test(txt)) return 'erro';

    // Qualquer outra coisa segue como 'aviso': o objetivo aqui é barrar SÓ a
    // página de erro conhecida. Bloquear o que eu não reconheço já se mostrou
    // pior — trava um caminho que funciona.
    return 'aviso';
  }

  function warningFromHtml(doc) {
    var t = $(doc).find('.booking-warning__content, .booking-warning__title').map(function () {
      return $(this).text().replace(/\s+/g, ' ').trim();
    }).get().join(' — ');
    return t || '';
  }

  // ------------------------------------------ preenche o form real (modo A)
  function applyPax(pax) {
    if (!pax.$row) return;
    var $row = pax.$row;
    var $fields = $row.find('.js-booking-paxes-fields');

    // 4 = CPF. O 2º argumento impede o handler do site de limpar o número.
    $row.find('[name=pax-idTDC]').val('4').trigger('change', [true]);

    var docValue = pax.docKind === 'cpf' ? maskCPF(pax.doc) : (pax.cpfFromFFP || pax.doc);
    var $doc = $row.find('[name=pax-document-number]').val(docValue);
    if (docValue.indexOf('*') > -1) $doc.removeAttr('data-validate');
    else $doc.attr('data-validate', '4');

    $fields.find('.booking-paxes__pax-fields-row--extra-fields').show();

    if (pax.treatment) $row.find('[name=pax-treatment]').val(pax.treatment).trigger('change');
    $row.find('[name=pax-name]').val(pax.name);
    $row.find('[name=pax-surname]').val(pax.surname);
    $row.find('[name=pax-birthday]').val(pax.birthday);
    if (pax.ffp) {
      $row.find('[name=pax-tipo-socio]').val('Tudo Azul');
      $row.find('[name=pax-numero-socio]').val(pax.ffp);
    }
    $fields.find('input[name=comId]').val(pax.comId || '');
  }

  // ------------------------------------------------- bookingPaxes (payload)
  // Mesma forma do payload que passou no teste de 13/08 (v3): só os campos que
  // o motor usa, idade real na data do check-in e nome em maiúsculas.
  function paxFromModel(p) {
    var doc = p.docKind === 'cpf' ? maskCPF(p.doc) : (p.cpfFromFFP || p.doc);

    // 🔴 paxType e paxAge são os da BUSCA, não os calculados do nascimento.
    // O serializer do site faz exatamente isso:
    //   i.paxType = t.data("pax-type"), i.paxAge = t.data("pax-age")
    // A tarifa foi precificada para uma criança de N anos; mandar outra idade
    // (porque o aniversário já passou, por exemplo) faz o motor receber um pax
    // que ele não cotou — e responder HTTP 500. Com dois adultos isso passava
    // batido, porque adulto é adulto em qualquer idade.
    // A idade calculada do nascimento continua sendo checada em warnings(),
    // como aviso para você, não como valor enviado.
    var tipo = parseInt(p.type, 10);
    var idade = parseInt(p.age, 10);
    if (isNaN(idade)) idade = ageAt(p.birthday, state.checkin);
    if (idade === null || isNaN(idade)) idade = tipo === 0 ? 30 : 0;

    return {
      paxType: tipo,
      paxAge: idade,
      treatment: p.treatment || '',
      name: String(p.name || '').toUpperCase(),
      surname: String(p.surname || '').toUpperCase(),
      birthday: p.birthday || '',
      idTDC: doc ? '4' : '',
      documentNumber: doc || '',
      resident: false,
      fidelityProgram: '',
      baggage: '',
      tipoSocio: p.ffp ? 'Tudo Azul' : '',
      numeroSocio: p.ffp || '',
      comId: digits(p.doc),
      numberOfBags: 0,
      baggageSelection: ''
    };
  }

  function buildPaxesInfo(state) {
    if (state.mode === 'form') {
      // caminho preferido: o serializer do próprio site
      try {
        var native = window.$jbe && $jbe.bookingPaxes &&
                     $jbe.bookingPaxes.getPaxesInfo($('.booking-data').find('.booking-paxes'));
        if (native && native.length) return native;
      } catch (e) { /* cai no builder próprio */ }
    }
    var rooms = [], byRoom = {};
    state.paxes.forEach(function (p) {
      var k = String(p.room);
      if (!byRoom[k]) { byRoom[k] = { numHab: parseInt(k, 10) || 1, paxes: [] }; rooms.push(byRoom[k]); }
      byRoom[k].paxes.push(paxFromModel(p));
    });
    return rooms;
  }

  function buildParams(state) {
    if (!state.refs) throw new Error('UID/optionID não encontrados — informe a tarifa no painel.');

    var params = {
      bookingPaxes: JSON.stringify(buildPaxesInfo(state)),
      action: 'book',
      optionID: state.refs.optionID,
      UID: state.refs.UID
    };

    var comIds = state.paxes.map(function (p) { return digits(p.doc); })
                            .filter(Boolean).join(',');
    if (comIds) params.comId = comIds;

    if (state.mode === 'form') {
      params.notes = $('[name=notes]').val() || null;
      var $slider = $('.points-slider__points-amount');
      if ($slider.length && $slider.val() !== undefined) {
        var n = parseInt(String($slider.val()).replace(/\D/g, ''), 10);
        params.pointsAmount = (n === 0 || isNaN(n)) ? '0' : n;
      }
      if (window.$jbe && $jbe.getFormParams) {
        $.extend(params, $jbe.getFormParams($('.booking-data').find('.booking-data__hidden-fields')));
        params.action = 'book';
        params.optionID = state.refs.optionID;
        params.UID = state.refs.UID;
        if (comIds) params.comId = comIds;
      }
    }

    $.each(params, function (k, v) {
      if (v === null || v === undefined || v === '') delete params[k];
    });
    return params;
  }

  // O POST 2 vai por fetch, não por navegação. Assim dá para LER a resposta:
  // se o site devolver a página de erro, nada foi criado e a gente mostra o
  // motivo em vez de jogar você numa tela de erro sem contexto. Deu certo,
  // navegamos para a URL final (GET), sem repetir o POST — repetir criaria
  // uma segunda reserva.
  async function submitBooking(state, params) {
    var url = state.mode === 'form'
      ? (window.urlChangeParams ? urlChangeParams(window.location.href) : window.location.href)
      : bookingUrl(state.refs.UID);

    if (state.mode === 'form' && window.sendPost) { window.sendPost(url, params); return; }

    var body = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var r, html;
    try {
      r = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body,
        redirect: 'follow'
      });
      html = await r.text();
    } catch (e) {
      log('❌ o POST 2 não completou: ' + e.message + '\nNada foi criado.');
      return;
    }

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var txt = ($(doc).find('body').text() || '').replace(/\s+/g, ' ').trim();

    if (/desculpe-nos|erro inesperado|houve um erro/i.test(txt)) {
      state.ultimaRespostaErro = txt.slice(0, 600);
      log('❌ O site respondeu com a PÁGINA DE ERRO no POST 2.\n' +
          'A reserva não foi criada — você continua na tela de resultados.\n\n' +
          'HTTP ' + r.status + ' · resposta: ' + txt.slice(0, 180) + '…\n\n' +
          'Clique em 🩺 e me mande o diagnóstico.');
      render();
      return;
    }

    if (/confirmbooking/i.test(r.url)) {
      log('✅ reserva criada — abrindo a tela de confirmação…');
      window.location.href = r.url;                 // GET, sem repetir o POST
      return;
    }

    // Respondeu algo que não é erro nem redirecionou: mostra a resposta na aba.
    log('resposta recebida (HTTP ' + r.status + ') — abrindo…');
    document.open(); document.write(html); document.close();
  }


  // ------------------------------------------------------------- interface
  var state = { mode: null, paxes: [], refs: null, fareLoaded: false,
               catalog: null, checkin: '',
               manual: { rooms: '1', adults: '', children: '' } };

  var domRows = readPaxRows(document, true);
  if (domRows.length) {
    state.mode = 'form';
    state.paxes = hydrate(domRows);
    state.fareLoaded = true;
  } else {
    var barra = readSearchBarPaxes();
    state.mode = $('.result[data-uid]').length || barra.length ? 'results' : 'headless';
    state.paxes = barra;
    state.fromSearchBar = barra.length > 0;
    state.fareLoaded = barra.length > 0;      // já dá pra preencher os paxes
  }
  state.refs = detectRefs();
  state.paxes.forEach(function (p, i) { if (!p.doc) p.doc = PRESET_DOCS[i] || ''; });

  var old = document.getElementById('azul-pax-panel');
  if (old) old.remove();

  var panel = document.createElement('div');
  panel.id = 'azul-pax-panel';
  panel.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'width:410px', 'max-height:92vh',
    'overflow:auto', 'z-index:2147483647', 'background:#101828', 'color:#e6edf7',
    'font:13px/1.45 system-ui,Segoe UI,Arial', 'border-radius:10px',
    'box-shadow:0 10px 40px rgba(0,0,0,.5)', 'padding:14px'
  ].join(';');
  document.body.appendChild(panel);

  var css = 'width:100%;box-sizing:border-box;padding:5px 7px;margin:2px 0;border-radius:5px;' +
            'border:1px solid #2d3748;background:#0b1220;color:#e6edf7';
  var btn = 'padding:8px;border:0;border-radius:6px;color:#fff;cursor:pointer';

  function summary() {
    if (!state.paxes.length) return 'nenhum pax carregado ainda';
    var ad = state.paxes.filter(function (p) { return p.type === '0'; }).length;
    var outros = state.paxes.filter(function (p) { return p.type !== '0'; })
      .map(function (p) { return p.typeLabel.toLowerCase() + ' ' + p.age + 'a'; });
    var rooms = {};
    state.paxes.forEach(function (p) { rooms[p.room] = 1; });
    return ad + ' adulto(s)' + (outros.length ? ' + ' + outros.join(', ') : '') +
           ' · ' + Object.keys(rooms).length + ' quarto(s) · ' + state.paxes.length + ' pax';
  }

  function fareBlock() {
    if (state.mode === 'form') return '';

    var opts = listResultOptions();
    var grupos = [], porHotel = {};
    opts.forEach(function (o, i) {
      if (!porHotel[o.hotel]) { porHotel[o.hotel] = []; grupos.push(o.hotel); }
      porHotel[o.hotel].push({ o: o, i: i });
    });
    var sel = '';
    if (opts.length) {
      sel = '<select data-f="pick" style="' + css + '">' +
        '<option value="">— escolher hotel / tarifa (' + opts.length + ' opções na tela) —</option>' +
        grupos.map(function (h) {
          return '<optgroup label="' + esc(h) + '">' +
            porHotel[h].map(function (x) {
              var marcado = state.refs && state.refs.optionID === x.o.optionID ? ' selected' : '';
              return '<option value="' + x.i + '"' + marcado + '>' +
                     esc(x.o.label) + (x.o._naTela === false ? ' (ainda não carregada na tela)' : '') +
                     '</option>';
            }).join('') + '</optgroup>';
        }).join('') + '</select>';
    }

    return '' +
    '<div style="border:1px solid ' + (state.faltaTarifa ? '#fc8181' : '#2d3748') +
         ';border-radius:8px;padding:8px;margin-bottom:10px">' +
      '<div style="color:' + (state.faltaTarifa ? '#fc8181' : '#9aa7b8') + ';margin-bottom:4px">Tarifa' +
        (state.refs ? ' — ' + esc(state.refs.hotel || state.refs.UID) + ' (' + esc(state.refs.from) + ')'
                    : ' — nenhuma escolhida') + '</div>' +
      sel +
      (state.fromSearchBar ? '' :
        '<button data-act="load-fare" style="' + btn + ';background:#2b6cb0;width:100%;margin-top:4px">Carregar tarifa e ler os passageiros</button>') +
    '</div>';
  }

  // composição na mão — usada quando não dá pra ler da busca nem do servidor
  function manualBlock() {
    if (state.paxes.length) return '';
    return '' +
    '<div style="border:1px solid #ecc94b55;border-radius:8px;padding:8px;margin-bottom:10px">' +
      '<div style="color:#ecc94b;margin-bottom:4px">Composição — não consegui ler da barra de busca</div>' +
      '<div style="display:flex;gap:4px;align-items:center">' +
        '<input data-f="m-rooms" value="' + esc(state.manual.rooms) + '" placeholder="quartos" style="' + css + ';width:70px">' +
        '<input data-f="m-adults" value="' + esc(state.manual.adults) + '" placeholder="adultos" style="' + css + ';width:80px">' +
        '<input data-f="m-children" value="' + esc(state.manual.children) + '" placeholder="idades das crianças (ex: 7,2)" style="' + css + '">' +
      '</div>' +
      '<button data-act="build-manual" style="' + btn + ';background:#4a5568;width:100%;margin-top:4px">Montar passageiros</button>' +
    '</div>';
  }

  function buildManualPaxes() {
    var rooms = Math.max(1, parseInt(state.manual.rooms, 10) || 1);
    var adults = Math.max(0, parseInt(state.manual.adults, 10) || 0);
    var ages = String(state.manual.children || '').split(/[,;\s]+/)
      .map(function (x) { return parseInt(x, 10); })
      .filter(function (x) { return !isNaN(x); });

    if (!adults) { log('❌ informe pelo menos 1 adulto.'); return; }

    var out = [], perRoomA = Math.ceil(adults / rooms), restA = adults, ci = 0;
    for (var r = 1; r <= rooms; r++) {
      var nA = Math.min(perRoomA, restA); restA -= nA;
      for (var a = 0; a < nA; a++) {
        out.push(newPax({
          room: r, type: '0', typeLabel: 'Adulto', age: 30, titles: TITLES_ADULT, treatment: 'MR',
          label: 'Adulto ' + (a + 1) + (rooms > 1 ? ' · quarto ' + r : '')
        }));
      }
      if (r === rooms) {
        for (; ci < ages.length; ci++) {
          out.push(newPax({
            room: r, type: ages[ci] < 2 ? '2' : '1', typeLabel: ages[ci] < 2 ? 'Bebê' : 'Criança',
            age: ages[ci], titles: TITLES_CHILD, treatment: 'MSTR',
            label: (ages[ci] < 2 ? 'Bebê ' : 'Criança ') + (ci + 1) + ' (' + ages[ci] + ' ano(s))'
          }));
        }
      }
    }
    state.paxes = hydrate(out);
    state.fareLoaded = true;
    render();
    log('composição montada: ' + out.length + ' pax. Informe os documentos.');
  }

  function paxBlock() {
    if (!state.fareLoaded) return '<div style="color:#9aa7b8">Defina a composição acima (ou carregue a tarifa) para listar os passageiros.</div>';
    return state.paxes.map(function (p, i) {
      var color = p.status === 'ok' ? '#48bb78' : p.status === 'manual' ? '#ecc94b' :
                  p.status === 'erro' ? '#fc8181' : p.status === 'padrão' ? '#63b3ed' : '#718096';
      return '' +
      '<div style="border:1px solid #2d3748;border-radius:8px;padding:8px;margin-bottom:8px">' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">' +
          '<strong style="flex:1">' + esc(p.label || (p.typeLabel + ' ' + (i + 1))) + '</strong>' +
          '<span style="color:' + color + '">' + esc(p.status) + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<select data-f="docKind" data-i="' + i + '" style="' + css + ';width:92px">' +
            '<option value="cpf"' + (p.docKind === 'cpf' ? ' selected' : '') + '>CPF</option>' +
            '<option value="ffp"' + (p.docKind === 'ffp' ? ' selected' : '') + '>TudoAzul</option>' +
          '</select>' +
          '<input data-f="doc" data-i="' + i + '" value="' + esc(p.doc) + '" placeholder="documento" style="' + css + '">' +
          '<button data-act="lookup" data-i="' + i + '" style="' + btn + ';background:#2b6cb0;padding:5px 9px">🔍</button>' +
        '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<input data-f="name" data-i="' + i + '" value="' + esc(p.name) + '" placeholder="Nome" style="' + css + '">' +
          '<input data-f="surname" data-i="' + i + '" value="' + esc(p.surname) + '" placeholder="Sobrenome" style="' + css + '">' +
        '</div>' +
        '<div style="display:flex;gap:4px">' +
          '<input data-f="birthday" data-i="' + i + '" value="' + esc(p.birthday) + '" placeholder="dd/mm/aaaa" style="' + css + ';width:110px">' +
          '<select data-f="treatment" data-i="' + i + '" style="' + css + ';width:120px">' +
            p.titles.map(function (t) {
              return '<option value="' + esc(t.value) + '"' + (p.treatment === t.value ? ' selected' : '') + '>' + esc(t.text) + '</option>';
            }).join('') +
          '</select>' +
          '<input data-f="ffp" data-i="' + i + '" value="' + esc(p.ffp) + '" placeholder="nº TudoAzul" style="' + css + '">' +
        '</div>' +
        (p.ageIncerta
          ? '<div style="display:flex;gap:4px;align-items:center">' +
              '<span style="color:#ecc94b;font-size:11px;flex:1">idade usada na busca (o site não me contou):</span>' +
              '<input data-f="age" data-i="' + i + '" value="' + (p.age == null ? '' : esc(p.age)) + '" ' +
                     'placeholder="anos" style="' + css + ';width:70px">' +
            '</div>'
          : '') +
      '</div>';
    }).join('') +
    '<div style="display:flex;gap:6px;margin:-2px 0 4px">' +
      '<button data-act="lookup-all" title="consulta cada documento no cadastro do TudoAzul" ' +
              'style="' + btn + ';background:#2b6cb0;flex:1">Consultar CPFs</button>' +
      '<button data-act="save-preset" title="salvar estes passageiros como padrão" ' +
              'style="' + btn + ';background:#2c5282;flex:1">💾 Salvar</button>' +
      '<button data-act="clear-preset" title="apagar o padrão salvo deste navegador" ' +
              'style="' + btn + ';background:#742a2a;flex:0 0 auto;padding:8px 12px">\uD83D\uDDD1\uFE0F Apagar</button>' +
    '</div>';
  }

  function header() {
    var modo = state.mode === 'form' ? 'formulário' : state.mode === 'results' ? 'resultados' : 'sem form';
    return '' +
      '<div data-act="drag" style="display:flex;align-items:center;gap:8px;margin:-14px -14px 8px;padding:10px 14px;' +
             'background:#0a2540;border-radius:10px 10px 0 0;cursor:move;user-select:none">' +
        '<span style="width:6px;height:18px;background:#00a3e0;border-radius:3px"></span>' +
        '<strong style="flex:1">Reserva TudoAzul <span style="font-weight:400;color:#8aa0b8;font-size:11px">v' + VERSION + '</span></strong>' +
        '<span style="color:#8aa0b8;font-size:11px">' + modo + '</span>' +
        '<button data-act="min" title="minimizar" style="background:none;border:0;color:#9aa7b8;cursor:pointer;font-size:15px">' +
          (state.min ? '▢' : '—') + '</button>' +
        '<button data-act="close" title="fechar" style="background:none;border:0;color:#9aa7b8;cursor:pointer;font-size:15px">✕</button>' +
      '</div>';
  }

  function render() {
    if (state.min) {
      panel.style.width = '260px';
      panel.innerHTML = header();
      return;
    }
    panel.style.width = '410px';
    panel.innerHTML =
      header() +
      '<div style="color:#9aa7b8;margin-bottom:10px">' + esc(summary()) +
        (state.cookieAviso ? ' · <span title="sem gravar cookie nenhum">🍪 ' + esc(state.cookieAviso) + '</span>' : '') +
      '</div>' +
      fareBlock() +
      manualBlock() +
      paxBlock() +
      (state.fareLoaded
        ? // ação principal, sozinha, com o aviso colado nela
          '<div style="margin-top:12px;padding:8px 10px;border-radius:6px;' +
               'border-left:3px solid #ecc94b;background:#1a1a10;color:#c9d6e5;font-size:12px">' +
            'Nada é reservado ao clicar: você vai para a tela de confirmação. ' +
            'Só que, no caminho, o site deixa de exibir as <strong>políticas do hotel</strong> — ' +
            'confira elas lá antes de finalizar.' +
          '</div>' +
          '<button data-act="send" style="' + btn + ';background:#2f855a;width:100%;margin-top:8px;' +
                 'font-weight:600;font-size:14px;padding:11px">Continuar para o cupom →</button>'
        : '') +
      '<div id="azul-pax-log" style="margin-top:10px;padding:8px;border-radius:6px;background:#0b1220;' +
        'border:1px solid #2d3748;color:#c9d6e5;white-space:pre-wrap;font-size:12px;min-height:18px"></div>' +
      // rodapé: diagnóstico + apoio
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #1e2836;display:flex;' +
             'align-items:center;gap:8px;font-size:12px">' +
        '<button data-act="diag" title="copia um relatório técnico, sem dado pessoal" ' +
                'style="' + btn + ';background:#2d3748;border:1px solid #4a5568;color:#c9d6e5;' +
                'padding:6px 10px;font-size:12px">🩺 Diagnóstico</button>' +
        '<a href="' + KOFI + '" target="_blank" rel="noopener" ' +
           'style="color:#00a3e0;text-decoration:none;margin-left:auto" ' +
           'title="ko-fi.com/eduoct">☕ Salvou sua viagem? Me paga um cafezinho de aeroporto</a>' +
      '</div>';
    if (lastLog) panel.querySelector('#azul-pax-log').textContent = lastLog;
  }

  var lastLog = '';
  function log(msg) {
    lastLog = msg;
    var el = panel.querySelector('#azul-pax-log');
    if (el) el.textContent = msg;
  }

  // Diagnóstico para suporte: nada de nome, CPF ou nº de programa — só o que
  // ajuda a entender por que quebrou.
  function copiarDiagnostico() {
    var d = [
      'Reserva TudoAzul v' + VERSION,
      'url: ' + window.location.pathname,
      'modo: ' + state.mode,
      'catálogo: ' + (state.catalog ? state.catalog.length + ' tarifas / ' + (state.hoteisTotal || '?') + ' hotéis / ' + (state.paginas || 1) + ' páginas' : 'não carregado'),
      'tarifa escolhida: ' + (state.refs ? (state.refs.from + (state.refs.hotel ? ' · ' + state.refs.hotel : '')) : 'nenhuma'),
      'check-in: ' + (state.checkin || '—'),
      resumoPreset(),
      'tarifas casadas no DOM: ' + (state.casadosNoDom || 0),
      'cookies do site: ' + (document.cookie.split(';').map(function (c) { return c.trim().split('=')[0]; })
                              .filter(function (n) { return /cookie|consent|lgpd/i.test(n); }).join(', ') || '(nenhum de consentimento)'),
      'accept-cookies presente: ' + ((document.cookie.match(/accept-cookies=/g) || []).length),
      'tarjas encontradas: ' + ((state.tarjas || []).join(' | ') || '(nenhuma)'),
      'botão de aceite clicado: ' + (state.aceiteClicado || '(nenhum)'),
      'pax: ' + state.paxes.length + ' (' +
        state.paxes.map(function (p) { return p.typeLabel + '/' + p.age + '/' + p.status; }).join(', ') + ')',
      'jQuery: ' + ($.fn && $.fn.jquery ? $.fn.jquery : '?'),
      'navegador: ' + navigator.userAgent,
      (state.ultimaRespostaErro ? '--- resposta do POST 2 ---\n' + state.ultimaRespostaErro : ''),
      '--- último log ---',
      lastLog || '(vazio)'
    ].join('\n');

    console.log(d);
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(d);
        log('🩺 diagnóstico copiado — cole na mensagem de suporte.\n(sem nome, CPF ou nº de programa)');
        return;
      }
    } catch (e) { /* segue pro fallback */ }
    log('🩺 diagnóstico impresso no console (F12) — copie de lá.');
  }

  // ------------------------------------------------------------- ações
  async function doLookup(p) {
    if (!digits(p.doc)) { p.status = 'sem doc'; render(); return; }
    p.status = '…'; render();
    try {
      var d = await lookup(p);
      p.name = d.Name || p.name;
      p.surname = d.LastName || p.surname;
      p.birthday = d.BirthDate || p.birthday;
      p.ffp = d.identifierNoFFP || p.ffp;
      p.comId = digits(p.doc);
      if (p.docKind === 'ffp') p.cpfFromFFP = d.identifierNoCPF || '';
      p.status = 'ok';
    } catch (err) {
      p.comId = '';
      p.status = /sem cadastro/.test(err.message) ? 'manual' : 'erro';
      log('[' + p.label + '] ' + err.message +
          (p.status === 'manual' ? ' — preencha os campos à mão' : ''));
    }
    render();
  }

  function warnings() {
    var w = [];
    state.paxes.forEach(function (p) {
      if (p.ageIncerta && (p.age == null || isNaN(p.age))) {
        w.push(p.label + ': FALTA a idade usada na busca — sem ela o site recusa a reserva');
      }
      if (!digits(p.doc)) w.push(p.label + ': documento vazio');
      if (!p.name || !p.surname) w.push(p.label + ': nome/sobrenome vazio');
      if (!parseBR(p.birthday)) { w.push(p.label + ': nascimento inválido'); return; }
      var a = ageAt(p.birthday, p.tripDate);
      if (a === null) return;
      if (p.type === '0' && a < p.adultAgeFrom) {
        w.push(p.label + ': nasc. dá ' + a + ' anos na viagem (adulto exige ' + p.adultAgeFrom + '+)');
      }
      if (p.type !== '0' && a !== p.age) {
        w.push(p.label + ': nasc. dá ' + a + ' anos na viagem, a busca pediu ' + p.age);
      }
    });
    return w;
  }

  async function loadFare() {
    if (!state.refs || !state.refs.UID || !state.refs.optionID) {
      log('❌ informe UID e optionID (ou escolha uma opção da tela de resultados).');
      return;
    }
    log('POST 1 — selecionando a tarifa…');
    try {
      var html = await selectFare(state.refs);
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var tipo = classifyBooking(doc, html);
      var rows = readPaxRows(doc, false);
      var aviso = warningFromHtml(doc);

      if (tipo === 'erro') {
        log('❌ O POST 1 voltou a página de erro do site ("Desculpe-nos, houve um erro").\n' +
            'Isso quase sempre é a sessão de busca ou o optionID vencido — eles morrem\n' +
            'junto com o searchSessionID.\n\n' +
            'Refaça a busca do zero, abra o painel de novo e escolha a tarifa outra vez.\n' +
            'NÃO mandei o POST 2 (seria o mesmo erro).');
        return false;
      }

      // Sem pontos suficientes, a booking devolve só o aviso — sem o formulário.
      // Isso é esperado: seguimos com a composição que já temos e mandamos o
      // POST 2 mesmo assim, que é justamente o que faz a tela de cupom abrir.
      if (!rows.length) {
        if (state.paxes.length) {
          state.fareLoaded = true;
          render();
          log('⚠️ o POST 1 não trouxe o formulário' + (aviso ? ' ("' + aviso + '")' : '') +
              '.\nSeguindo com os ' + state.paxes.length + ' pax preenchidos aqui — é o caminho normal quando falta ponto.');
          return true;
        }
        log('❌ o POST 1 não trouxe formulário e eu não tenho composição de passageiros.' +
            (aviso ? '\nA página respondeu: "' + aviso + '"' : '') +
            '\nDefina os passageiros no bloco "Composição" acima.');
        return false;
      }
      if (state.paxes.length && rows.length !== state.paxes.length) {
        log('⚠️ a barra de busca dizia ' + state.paxes.length + ' pax, o servidor pediu ' +
            rows.length + '. Vale a do servidor — confira os campos.');
      }
      mergeTyped(rows, state.paxes);
      hydrate(rows);
      rows.forEach(function (p, i) { if (!p.doc) p.doc = PRESET_DOCS[i] || ''; });
      state.paxes = rows;
      state.fareLoaded = true;
      render();
      if (aviso) log('ℹ️ a página respondeu: "' + aviso + '" — é só render, o POST 2 segue.');
      return true;
    } catch (err) {
      log('❌ ' + err.message);
      return false;
    }
  }

  panel.addEventListener('input', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    if (f === 'uid' || f === 'optionid') {
      state.refs = state.refs || { UID: '', optionID: '', from: 'manual' };
      state.refs[f === 'uid' ? 'UID' : 'optionID'] = e.target.value.trim();
      return;
    }
    if (f.indexOf('m-') === 0) { state.manual[f.slice(2)] = e.target.value; return; }
    var p = state.paxes[+e.target.getAttribute('data-i')];
    if (!p) return;
    p[f] = f === 'age' ? parseInt(e.target.value, 10) : e.target.value;
    if (p.status === 'erro' && /^(name|surname|birthday)$/.test(f)) p.status = 'manual';
  });

  panel.addEventListener('change', function (e) {
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    if (f === 'pick') {
      var o = listResultOptions()[+e.target.value];
      if (o) {
        state.refs = { UID: o.uid, optionID: o.optionID, hotel: o.hotel + ' · ' + o.label, from: 'escolhida na tela', _cat: o._cat };
        var msg = 'tarifa: ' + o.hotel + ' — ' + o.label;
        if (o._cat) {
          state.checkin = brDate(o._cat.checkin);
          var d = o._cat.dist;
          if (d) {
            var esperado = (d.adults || 0) + (d.children || 0) + (d.babies || 0);
            if (!state.paxes.length) {
              state.paxes = paxesFromDistribution(d);
              state.fareLoaded = true;
            } else if (state.paxes.length !== esperado) {
              msg += '\n⚠️ a busca é para ' + d.adults + ' adulto(s), ' + (d.children || 0) +
                     ' criança(s) e ' + (d.babies || 0) + ' bebê(s) — você tem ' +
                     state.paxes.length + ' pax no painel.';
            }
            state.dist = d;
          }
          if (state.checkin) msg += '\ncheck-in ' + state.checkin + ' (idade dos pax calculada nessa data)';
        }
        render();
        log(msg);
      }
      return;
    }
    if (f === 'uid' || f === 'optionid') return;
    var p = state.paxes[+e.target.getAttribute('data-i')];
    if (p) p[f] = e.target.value;
  });

  panel.addEventListener('click', function (e) {
    var act = e.target.getAttribute('data-act');
    if (!act) return;
    Promise.resolve(handleClick(act, e)).catch(function (err) {
      console.error('[azul] falha no botão "' + act + '":', err);
      log('❌ erro no botão "' + act + '": ' + (err && err.message || err) +
          '\n(o stack completo está no console)');
    });
  });

  async function handleClick(act, e) {

    if (act === 'close') { panel.remove(); return; }
    if (act === 'min') { state.min = !state.min; render(); return; }
    if (act === 'drag') return;   // tratado no mousedown
    if (act === 'load-fare') { await loadFare(); return; }
    if (act === 'build-manual') { buildManualPaxes(); return; }
    if (act === 'save-preset') { savePreset(); return; }
    if (act === 'clear-preset') { clearPreset(); return; }
    if (act === 'diag') { copiarDiagnostico(); return; }
    if (act === 'lookup') { await doLookup(state.paxes[+e.target.getAttribute('data-i')]); return; }

    if (act === 'lookup-all') {
      log('consultando…');
      for (var i = 0; i < state.paxes.length; i++) { await doLookup(state.paxes[i]); await sleep(400); }
      var w = warnings();
      log(w.length ? '⚠️ ' + w.join('\n⚠️ ') : 'tudo pronto — pode simular.');
      return;
    }

    if (act === 'dry' || act === 'send') {
      // fora do modo formulário, o POST 1 tem que acontecer imediatamente antes
      // do POST 2 — é ele que deixa a tarifa selecionada na sessão
      if (state.mode !== 'form') {
        if (!state.refs || !state.refs.UID || !state.refs.optionID) {
          state.faltaTarifa = true;
          render();
          log('❌ escolha o hotel e a tarifa no dropdown antes de simular/reservar.');
          return;
        }
        state.faltaTarifa = false;
        // 🔴 NÃO chamar results.ashx aqui. Ele re-roda a busca na sessão e
        // invalida o optionID que estamos segurando — foi o que quebrou a
        // reserva em 15/08. A sequência boa é POST 1 e POST 2 colados, sem
        // nenhuma outra chamada no meio.
        log('POST 1 — selecionando a tarifa…');
        if (!await loadFare()) return;
      }

      var w2 = warnings();
      state.paxes.forEach(applyPax);              // no-op no modo sem form
      var params;
      try { params = buildParams(state); }
      catch (err) { log('❌ ' + err.message); return; }

      console.log('%c[azul] payload', 'color:#48bb78', params);
      console.log('%c[azul] bookingPaxes', 'color:#48bb78', JSON.parse(params.bookingPaxes));

      if (act === 'dry') {
        var bp = JSON.parse(params.bookingPaxes);
        var nPax = bp.reduce(function (n, r) { return n + r.paxes.length; }, 0);
        var resumoSim =
          '✅ SIMULAÇÃO OK — nada foi enviado.\n' +
          'tarifa: ' + (state.refs.hotel || state.refs.UID) + '\n' +
          'passageiros: ' + nPax + ' → ' +
            bp[0].paxes.map(function (p) { return p.name + ' (' + p.paxAge + ')'; }).join(', ') + '\n' +
          'payload: ' + params.bookingPaxes.length + ' bytes · campos: ' + Object.keys(params).join(', ') +
          (w2.length ? '\n\n⚠️ ' + w2.join('\n⚠️ ') : '');
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(params, null, 2));
        } catch (err) { /* clipboard é opcional */ }
        log(resumoSim);
        return;
      }

      var resumo = state.paxes.map(function (p) {
        return '• ' + p.name + ' ' + p.surname + ' (' + p.birthday + ')';
      }).join('\n');

      // A booking.aspx é pulada — e é lá que ficam as políticas do hotel.
      var cat = state.refs && state.refs._cat;
      var politica =
        '\n\nNada é reservado agora. Você vai para a tela de confirmação, onde\n' +
        'aplica o cupom e decide se finaliza.\n\n' +
        '⚠️ No caminho normal do site existe uma página que mostra as políticas\n' +
        'do hotel — cancelamento, horário de check-in e check-out, taxas cobradas\n' +
        'no destino. Este atalho não passa por ela, então essas regras não vão\n' +
        'aparecer para você.' +
        (cat && cat.semReemb ? '\n\n🔴 Esta tarifa está marcada como NÃO REEMBOLSÁVEL.' : '') +
        '\n\nConfira as condições na tela de confirmação antes de finalizar o resgate.';

      if (!confirm('Ir para a tela de confirmação?\n\n' + resumo +
                   (w2.length ? '\n\nAvisos:\n' + w2.join('\n') : '') +
                   politica)) { log('cancelado.'); return; }
      log('enviando…');
      await submitBooking(state, params);
    }
  }

  // A lista de resultados é re-renderizada pelo site a cada filtro, ordenação
  // ou paginação. Sem isto o dropdown congelava na primeira leitura.
  var reobservar = null;
  function observarResultados() {
    if (!window.MutationObserver) return;
    // 🔴 nunca observar o body: o painel vive dentro dele, então render()
    // dispararia o observer, que chamaria render() — loop infinito.
    var alvo = document.querySelector('.js-results-list-placeholder, .results-list__body, .results-list') ||
               document.querySelector('[class*="results-list"], [class*="result-list"]') ||
               ($('.result[data-uid]').first().parent()[0]) ||
               null;
    if (!alvo || alvo === document.body || (panel && alvo.contains(panel))) {
      state.observando = false;
      return;
    }
    state.observando = true;

    var timer = null;
    var obs = new MutationObserver(function (muts) {
      // mutação nossa (o painel) não conta
      var soNossa = muts.every(function (m) { return panel && panel.contains(m.target); });
      if (soNossa) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (state.min) return;                       // painel fechado, não mexe
        var antes = state.refs && state.refs.optionID;
        render();                                    // reordena pelo DOM novo
        if (antes) {
          var ainda = listResultOptions().some(function (o) {
            return o.optionID === antes && o._naTela;
          });
          if (!ainda) {
            log('ℹ️ a lista da tela mudou e a tarifa que você escolheu não está mais visível.\n' +
                'Ela continua selecionada — se não for a que você quer, escolha de novo.');
          }
        }
      }, 400);
    });
    obs.observe(alvo, { childList: true, subtree: true });
    reobservar = obs;
  }
  observarResultados();

  // arrastar pelo cabeçalho
  panel.addEventListener('mousedown', function (e) {
    if (e.target.getAttribute('data-act') !== 'drag') return;
    var r = panel.getBoundingClientRect();
    var dx = e.clientX - r.left, dy = e.clientY - r.top;
    function move(ev) {
      panel.style.left = Math.max(0, ev.clientX - dx) + 'px';
      panel.style.top = Math.max(0, ev.clientY - dy) + 'px';
      panel.style.right = 'auto';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });

  // carrega o catálogo do results.ashx (fonte do v3) e refaz o painel
  if (state.mode !== 'form') {
    loadCatalog().then(function (cat) {
      if (!cat) { log('results.ashx não respondeu — usando as tarifas visíveis na tela.'); return; }
      state.catalog = cat;
      if (!state.paxes.length && cat[0].dist) {
        state.paxes = paxesFromDistribution(cat[0].dist);
        state.fareLoaded = state.paxes.length > 0;
      }
      state.checkin = state.checkin || brDate(cat[0].checkin);
      render();
      var d = cat[0].dist || {};
      completarTarifas(qsParam('searchSessionID') ||
                       (/searchSessionID=(\d+)/.exec(window.location.hash) || [])[1]);
      log('catálogo: ' + cat.length + ' tarifa(s) em ' + (state.hoteisTotal || '?') + ' hotel(is)' +
          (state.paginas > 1 ? ', ' + state.paginas + ' páginas' : '') + ' · busca para ' +
          (d.adults || 0) + ' adulto(s), ' + (d.children || 0) + ' criança(s), ' +
          (d.babies || 0) + ' bebê(s)' + (state.checkin ? ' · check-in ' + state.checkin : '') + '.\n' +
          resumoPreset());
    }).catch(function (e) { log('falha lendo results.ashx: ' + e.message); });
  }

  var ckLimpo = limparCookieDuplicado();
  var ckFix;
  if (ckLimpo.tinha > 1) {
    ckFix = { ok: false, motivo: 'duplicata removida', via: '' };
  } else if (aceitarPeloSite()) {
    ckFix = { ok: true, via: 'botão do site' };
  } else {
    ckFix = fixarAceite();
    ckFix.via = 'gravado pelo painel';
  }
  var tarjas = esconderTarjaCookies();

  render();
  log(state.mode === 'form'
    ? 'Formulário encontrado: ' + state.paxes.length + ' pax.'
    : state.mode === 'results'
      ? 'Composição lida da barra de busca: ' + state.paxes.length + ' pax. ' +
        'Escolha o hotel/tarifa, preencha os CPFs e clique em Reservar.'
      : 'Sem formulário nesta página — modo dois POSTs. ' +
        (state.refs ? 'Tarifa detectada, é só carregar.' : 'Escolha/cole a tarifa (UID + optionID).'));

  if (ckLimpo.tinha > 1) {
    state.cookieAviso = 'cookie duplicado removido';
  } else if (ckFix.ok) {
    state.cookieAviso = 'aceite de cookies válido (' + ckFix.via + ')';
  } else if (tarjas) {
    state.cookieAviso = tarjas + ' tarja(s) escondida(s)';
  } else if ((document.cookie.match(/accept-cookies=/g) || []).length) {
    state.cookieAviso = 'cookie de aceite presente';
  }
  if (state.cookieAviso) render();

  window.__azulPax = {
    version: VERSION,
    preset: loadPreset,
    limparCookieDuplicado: limparCookieDuplicado,
    fixarAceite: fixarAceite,
    aceitarPeloSite: aceitarPeloSite,
    esconderTarjaCookies: esconderTarjaCookies,
    resumoPreset: resumoPreset,
    diagnostico: copiarDiagnostico,
    simular: function () { return handleClick('dry'); },
    reservar: function () { return handleClick('send'); },
    state: state, lookup: lookup, buildParams: function () { return buildParams(state); },
    apply: function () { state.paxes.forEach(applyPax); },
    detectRefs: detectRefs, listResultOptions: listResultOptions, loadFare: loadFare
  };
})();
