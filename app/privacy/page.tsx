export const metadata = { title: '隐私政策 · 紫微命盘', description: '紫微命盘隐私政策' };

export default function PrivacyPage() {
  const heading = { fontSize: 18, marginTop: 32, marginBottom: 12 };
  return (
    <>
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--bg-0)', borderBottom: '1px solid var(--bdr)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--tx-3)', textDecoration: 'none' }}>
          <span style={{ fontSize: '16px' }}>‹</span>
          <span>返回首页</span>
        </a>
        <div style={{ width: '1px', height: '20px', background: 'var(--bdr-med)' }} />
        <span style={{ fontSize: '12px', color: 'var(--ac)', letterSpacing: '0.2em' }}>紫微命盘</span>
      </header>
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px 80px', color: 'var(--tx-1)', lineHeight: 1.8 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>隐私政策</h1>
        <p style={{ fontSize: 12, color: 'var(--tx-3)', marginBottom: 32 }}>最后更新：2026年8月</p>

        <h2 style={heading}>1. 我们处理的信息</h2>
        <ul style={{ paddingLeft: 24 }}>
          <li><strong>排盘信息</strong>：出生年月日、出生时辰、性别及排盘结果，用于生成和展示命盘。</li>
          <li><strong>AI交互记录</strong>：用户问题、AI生成结果、命盘摘要、成功或失败状态与响应耗时。</li>
          <li><strong>匿名技术信息</strong>：随机会话编号及Cloudflare提供的国家或地区代码。</li>
        </ul>
        <p>系统不在询问记录中保存真实IP地址。请勿在问题中输入姓名、身份证号、手机号、住址等可直接识别身份的信息。</p>

        <h2 style={heading}>2. 信息用途</h2>
        <ul style={{ paddingLeft: 24 }}>
          <li>完成排盘与AI命理解读。</li>
          <li>查看每次询问是否成功，定位超时与服务错误。</li>
          <li>在匿名基础上改进回答质量、输入限制和系统稳定性。</li>
        </ul>

        <h2 style={heading}>3. 保存期限</h2>
        <p>AI询问记录默认保存30天，系统按保留周期自动清理。管理员也可以提前删除单条或批量记录。</p>

        <h2 style={heading}>4. 第三方服务</h2>
        <p>本站使用Cloudflare承载网站、数据库及安全服务，并将命盘上下文和对话发送给后端配置的AI解读服务。浏览器不会获得AI服务密钥、模型配置或系统提示词。</p>

        <h2 style={heading}>5. 安全措施</h2>
        <p>管理后台通过Cloudflare Access限制为指定管理员邮箱，并在应用层再次核对管理员身份。数据库不向浏览器直接开放，记录查询、导出和删除均通过受保护的服务端接口完成。</p>

        <h2 style={heading}>6. Cookie与本地存储</h2>
        <p>本站使用localStorage保存主题偏好和随机匿名会话编号，以便将同一浏览器中的连续提问归为一个匿名会话。清除浏览器站点数据后会生成新的编号。</p>

        <h2 style={heading}>7. 使用提醒</h2>
        <p>本站内容用于传统文化研究与休闲参考，不应作为医疗、法律、投资或其他重大决定的唯一依据。未成年人请在监护人同意下使用。</p>

        <h2 style={heading}>8. 政策变更</h2>
        <p>如记录范围、用途或保存期限发生重大变化，本站将更新本页面并调整最后更新日期。</p>

        <p style={{ marginTop: 48, fontSize: 12, color: 'var(--tx-3)' }}>
          <a href="/terms" style={{ color: 'var(--ac)' }}>服务条款</a> · <a href="/" style={{ color: 'var(--ac)' }}>返回首页</a>
        </p>
      </main>
    </>
  );
}
