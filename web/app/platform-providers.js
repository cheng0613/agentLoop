// 平台管理 → 共享模型凭据
//
// 团队部署通常自建统一 API 网关，成员不各自填写模型 Key。这里为每个 Agent CLI
// 配一次 API Key / BaseURL / 协议 / 模型，运行时按「个人优先、共享补齐」取值。
//
// 与「共享 CodeBuddy Key」的关系：那个 tab 是历史实现，只覆盖 CodeBuddy 且带
// 网络环境字段；本页覆盖全部 CLI。两者写同一份存储，改任一处都能生效。

const PROVIDER_PROTOCOL_LABELS = {
  chat: 'OpenAI Chat Completions',
  responses: 'OpenAI Responses',
  messages: 'Anthropic Messages',
  gemini: 'Google Gemini',
};

function platformProvidersHTML() {
  return `
    <div class="platform-admin-layout">
      <div class="platform-admin-main-card">
        <div class="platform-admin-head">
          <div class="platform-admin-head-meta">
            <h2>共享模型凭据</h2>
            <p>团队成员不各自填写模型 Key。这里为每个 Agent CLI 配一次：填了 Key 的 CLI 全员可直接使用，个人配置仍然优先。使用统一网关时，把各 CLI 的 Base URL 指向同一个地址即可。</p>
          </div>
          <span class="platform-admin-count-pill" id="platformProviderCount">--</span>
        </div>
        <div id="platformProviderList" class="platform-provider-list">
          <div class="platform-empty-state"><b>正在加载…</b></div>
        </div>
      </div>
    </div>`;
}

// 一行一个 provider。已配置的展开可编辑，未配置的收起，点「配置」展开。
function platformProviderRowHTML(p) {
  const configured = !!p.configured;
  const enabled = !!p.enabled;
  const tone = configured ? (enabled ? 'on' : 'legacy') : 'off';
  const stateText = configured ? (enabled ? '已启用' : '已停用') : '未配置';
  const models = Array.isArray(p.models) ? p.models : [];
  const protocols = Array.isArray(p.protocols) ? p.protocols : [];
  const protocolOptions = protocols.length
    ? protocols.map((value) => `<option value="${escapeHTML(value)}"${value === p.protocol ? ' selected' : ''}>${escapeHTML(PROVIDER_PROTOCOL_LABELS[value] || value)}</option>`).join('')
    : '<option value="">该 CLI 不支持自定义协议</option>';
  const detail = configured
    ? `${models.length} 个模型${p.defaultModel ? ` · 默认 ${escapeHTML(p.defaultModel)}` : ''}${p.baseUrl ? ` · ${escapeHTML(p.baseUrl)}` : ' · 官方端点'}${p.updatedBy ? ` · ${escapeHTML(p.updatedBy)} 修改` : ''}`
    : '未配置共享凭据，成员需要各自填写';

  return `<div class="platform-provider-row" data-provider-row="${escapeHTML(p.provider)}" data-configured="${configured ? '1' : '0'}">
    <div class="platform-provider-head">
      <div class="platform-provider-title">
        <b>${escapeHTML(p.label || p.provider)}</b>
        <code>${escapeHTML(p.provider)}</code>
        <span class="platform-provider-state is-${tone}">${stateText}</span>
      </div>
      <div class="platform-provider-detail">${detail}</div>
      <div class="platform-provider-actions">
        ${
          configured
            ? `<button type="button" class="button ghost small" data-provider-edit="${escapeHTML(p.provider)}">编辑</button>
               <button type="button" class="button ghost small" data-provider-probe="${escapeHTML(p.provider)}">连通性测试</button>
               <button type="button" class="button danger-outline small" data-provider-clear="${escapeHTML(p.provider)}">清除</button>`
            : `<button type="button" class="button primary small" data-provider-edit="${escapeHTML(p.provider)}">配置</button>`
        }
      </div>
    </div>
    <form class="platform-provider-form" data-provider-form="${escapeHTML(p.provider)}" hidden>
      <label><span>API Key</span>
        <input name="apiKey" type="password" autocomplete="off" spellcheck="false"
          placeholder="${configured ? '已配置，留空保持不变' : '粘贴该 CLI 的 API Key'}">
      </label>
      <label><span>Base URL</span>
        <input name="baseUrl" type="text" autocomplete="off" spellcheck="false"
          value="${escapeHTML(p.baseUrl || '')}" placeholder="留空使用官方端点；统一网关填网关地址">
      </label>
      <label><span>协议</span>
        <select name="protocol">${protocolOptions}</select>
      </label>
      <label><span>模型（逗号分隔，第一个为默认）</span>
        <input name="models" type="text" autocomplete="off" spellcheck="false"
          value="${escapeHTML(models.join(', '))}" placeholder="gpt-4o, claude-sonnet-4">
      </label>
      <label class="platform-provider-enabled"><input name="enabled" type="checkbox"${enabled || !configured ? ' checked' : ''}> 启用</label>
      <p class="platform-provider-result" data-provider-result hidden></p>
      <div class="platform-provider-form-actions">
        <button type="submit" class="button primary small">保存</button>
        <button type="button" class="button ghost small" data-provider-cancel="${escapeHTML(p.provider)}">取消</button>
      </div>
    </form>
  </div>`;
}

async function loadPlatformProviders(host) {
  const list = host.querySelector('#platformProviderList');
  const count = host.querySelector('#platformProviderCount');
  if (!list) return;

  let providers = [];
  let status = null;

  const render = () => {
    if (!providers.length) {
      list.innerHTML = '<div class="platform-empty-state"><b>没有可配置的 CLI</b><p>该部署没有注册任何 Agent CLI。</p></div>';
      return;
    }
    const configured = providers.filter((p) => p.configured).length;
    if (count) count.textContent = `已配置 ${configured} / ${providers.length}`;
    // 已配置的排前面，方便管理员一眼看到现状。
    const ordered = providers.slice().sort((a, b) => Number(!!b.configured) - Number(!!a.configured));
    list.innerHTML = ordered.map(platformProviderRowHTML).join('');
    bind();
  };

  const bind = () => {
    list.querySelectorAll('[data-provider-edit]').forEach((btn) => {
      btn.onclick = () => {
        const row = list.querySelector(`[data-provider-row="${btn.dataset.providerEdit}"]`);
        const form = row?.querySelector('[data-provider-form]');
        if (form) form.hidden = !form.hidden;
      };
    });
    list.querySelectorAll('[data-provider-cancel]').forEach((btn) => {
      btn.onclick = () => {
        const row = list.querySelector(`[data-provider-row="${btn.dataset.providerCancel}"]`);
        const form = row?.querySelector('[data-provider-form]');
        if (form) form.hidden = true;
      };
    });
    list.querySelectorAll('[data-provider-form]').forEach((form) => {
      form.onsubmit = async (event) => {
        event.preventDefault();
        await saveProvider(form);
      };
    });
    list.querySelectorAll('[data-provider-probe]').forEach((btn) => {
      btn.onclick = () => probeProvider(btn.dataset.providerProbe, btn);
    });
    list.querySelectorAll('[data-provider-clear]').forEach((btn) => {
      btn.onclick = () => clearProvider(btn.dataset.providerClear);
    });
  };

  const saveProvider = async (form) => {
    const provider = form.dataset.providerForm;
    const data = new FormData(form);
    const models = String(data.get('models') || '')
      .split(/[,，\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (!models.length) return toast('请至少填写一个模型', 'err');
    const body = {
      apiKey: String(data.get('apiKey') || '').trim(),
      baseUrl: String(data.get('baseUrl') || '').trim(),
      protocol: String(data.get('protocol') || '').trim(),
      models,
      defaultModel: models[0],
      enabled: data.get('enabled') === 'on',
    };
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await api(`/api/platform/providers/${encodeURIComponent(provider)}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('已保存', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      if (submit) submit.disabled = false;
    }
  };

  const clearProvider = async (provider) => {
    const label = providers.find((p) => p.provider === provider)?.label || provider;
    if (!(await afConfirm({ title: '清除共享凭据', message: `清除后，没配自己 Key 的成员将无法使用 ${label}。确定清除？`, danger: true, confirmText: '清除' }))) return;
    try {
      await api(`/api/platform/providers/${encodeURIComponent(provider)}`, { method: 'DELETE' });
      toast('已清除', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const probeProvider = async (provider, btn) => {
    const form = list.querySelector(`[data-provider-form="${provider}"]`);
    const result = form?.querySelector('[data-provider-result]');
    if (btn) btn.disabled = true;
    if (result) {
      result.hidden = false;
      result.className = 'platform-provider-result';
      result.textContent = '正在测试…';
    }
    try {
      const res = await api(`/api/platform/providers/${encodeURIComponent(provider)}/probe`, { method: 'POST' });
      if (result) {
        result.className = `platform-provider-result ${res?.ok ? 'is-ok' : 'is-fail'}`;
        result.textContent = `${res?.message || ''}${res?.detail ? `\n${res.detail}` : ''}`;
      } else {
        toast(res?.message || '测试完成', res?.ok ? 'ok' : 'err');
      }
    } catch (err) {
      // 502 带着失败详情：把响应体里的结论显示出来，比一行 toast 有用。
      if (result) {
        result.className = 'platform-provider-result is-fail';
        result.textContent = err.message;
      } else {
        toast(err.message, 'err');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  const refresh = async () => {
    providers = await api('/api/platform/providers');
    render();
  };

  try {
    providers = await api('/api/platform/providers');
    render();
  } catch (err) {
    list.innerHTML = `<div class="platform-empty-state"><b>加载失败</b><p>${escapeHTML(err.message || '')}</p></div>`;
  }
  return status;
}
