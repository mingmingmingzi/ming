import { Link } from '@umijs/max';
import { Alert, Button, Card, Col, Empty, Form, Input, List, Progress, Radio, Row, Select, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { labelingJson, labelingRequest, post, segment, sha256, uploadChunks } from '@/services/labeling';
import type { AssignmentItem, Batch, Draft, Page, Project, Sample, Spec } from '@/services/labeling';

const { Title, Text, Paragraph } = Typography;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const id = segment;

export default function LabelingWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [project, setProject] = useState<Project>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<Batch>();
  const [batchInput, setBatchInput] = useState('');
  const [file, setFile] = useState<File>();
  const [progress, setProgress] = useState(0);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sampleCursor, setSampleCursor] = useState<string | null>();
  const [selected, setSelected] = useState<Sample>();
  const [image, setImage] = useState('');
  const [imageError, setImageError] = useState('');
  const [assignmentInput, setAssignmentInput] = useState('');
  const [assignment, setAssignment] = useState('');
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [itemCursor, setItemCursor] = useState<string | null>();
  const [choice, setChoice] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [labelNames, setLabelNames] = useState('正常\n异常');
  const [instructions, setInstructions] = useState('查看图片，选择最符合的类别。');
  const controller = useRef<AbortController | null>(null);
  const keys = useRef(new Map<string, string>());
  const latestSpec: Spec | undefined = project?.specVersions?.reduce<Spec | undefined>((latest, spec) => !latest || spec.versionNo > latest.versionNo ? spec : latest, undefined);
  const activeItem = assignment && selected ? items.find(item => item.sampleId === selected.sampleId) : undefined;
  const taskSpec = project?.specVersions?.find(spec => spec.specVersionId === activeItem?.specVersionId);
  const editable = Boolean(activeItem && taskSpec && activeItem.readOnly !== true && activeItem.editable === true);
  const labels = (assignment ? taskSpec : latestSpec)?.labels ?? [];

  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function write<T>(path: string, body?: unknown) {
    const signature = path + JSON.stringify(body);
    if (!keys.current.has(signature)) keys.current.set(signature, crypto.randomUUID());
    return post<T>(path, body, keys.current.get(signature)!);
  }
  async function loadProjects(next?: string) {
    const page = await labelingJson<Page<Project>>(`/projects?scope=owned&limit=20${next ? `&cursor=${id(next)}` : ''}`);
    setProjects(previous => next ? [...previous, ...page.items] : page.items); setCursor(page.nextCursor);
  }
  function clearWorkspace() {
    setBatch(undefined); setBatchInput(''); setFile(undefined); setSamples([]); setSampleCursor(null);
    setAssignment(''); setAssignmentInput(''); setItems([]); setItemCursor(null); setSelected(undefined); setDraft(undefined); setChoice('');
  }
  async function openProject(projectId: string) {
    const detail = await labelingJson<Project>(`/projects/${id(projectId)}`);
    clearWorkspace(); setProject(detail);
  }
  useEffect(() => {
    void action(async () => { await labelingJson('/me'); await loadProjects(); });
    return () => controller.current?.abort();
  }, []);
  // Authenticated images are fetched as blobs; never place bearer tokens in URLs.
  useEffect(() => {
    setImage(''); setImageError('');
    if (!selected || !project) return;
    const abort = new AbortController(); let objectUrl = '';
    const path = assignment
      ? `/assignments/${id(assignment)}/samples/${id(selected.sampleId)}/file`
      : `/projects/${id(project.projectId)}/samples/${id(selected.sampleId)}/file`;
    void labelingRequest(path, { signal: abort.signal }).then(async response => {
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('文件接口未返回图片媒体类型');
      if (!abort.signal.aborted) { objectUrl = URL.createObjectURL(blob); setImage(objectUrl); }
    }).catch(e => { if (!abort.signal.aborted) setImageError(errorText(e)); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected?.sampleId, project?.projectId, assignment]);

  async function queryBatch(batchId: string) {
    const current = await labelingJson<Batch>(`/imports/${id(batchId)}`);
    if (current.projectId !== project?.projectId) throw new Error('批次不属于当前项目');
    setBatch(current); return current;
  }
  useEffect(() => {
    if (batch?.status !== 'PROCESSING') return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void labelingJson<Batch>(`/imports/${id(batch.batchId)}`, { signal: abort.signal }).then(current => {
        if (!abort.signal.aborted) setBatch(current);
      }).catch(e => { if (!abort.signal.aborted) setError(errorText(e)); });
    }, 2000);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [batch]);
  async function loadSamples(next?: string) {
    if (!batch) return;
    const page = await labelingJson<Page<Sample>>(`/imports/${id(batch.batchId)}/samples?limit=20${next ? `&cursor=${id(next)}` : ''}`);
    setSamples(previous => next ? [...previous, ...page.items] : page.items); setSampleCursor(page.nextCursor);
  }
  function selectSample(sample: Sample) {
    setSelected(sample); const saved = items.find(item => item.sampleId === sample.sampleId)?.draft;
    setDraft(saved); setChoice(saved?.result?.[0]?.value?.choices?.[0] ?? ''); setNotice('');
  }
  async function loadAssignment(next?: string) {
    const assignmentId = next ? assignment : assignmentInput.trim();
    if (!assignmentId) throw new Error('请输入后端提供的本人 assignmentId');
    const page = await labelingJson<Page<AssignmentItem>>(`/assignments/${id(assignmentId)}/items?limit=20${next ? `&cursor=${id(next)}` : ''}`);
    setAssignment(assignmentId); setItems(previous => next ? [...previous, ...page.items] : page.items);
    setItemCursor(page.nextCursor); setSelected(undefined); setDraft(undefined); setChoice('');
  }

  return <main style={{ maxWidth: 1440, margin: '0 auto', padding: 24 }}>
    <Space><Link to="/platforms">← 平台选择</Link><Link to="/label-projects">打开原标注 Demo</Link></Space>
    <Title level={2}>图片分类标注</Title>
    <Paragraph>创建项目、配置分类规范、导入图片，并在本人领取的任务中保存分类草稿。</Paragraph>
    <Alert type="info" showIcon message="开发联调版 · 使用真实接口" description="身份、项目与规范已有基础实现；图片导入已按 image-import 分支适配，待部署联调；领取、草稿及 Label Studio 接口待后端提供。接口失败会明确显示，页面不会自动切换假数据。保存草稿不等于整包提交。" style={{ marginBottom: 16 }} />
    {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} style={{ marginBottom: 16 }} />}
    {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 16 }} />}
    <Row gutter={[20, 20]}>
      <Col xs={24} lg={7}>
        <Card title="我的项目" extra={<Button disabled={busy} onClick={() => void action(() => loadProjects())}>刷新</Button>}>
          <List dataSource={projects} locale={{ emptyText: '暂无项目，或尚未成功连接标注服务' }} renderItem={p => <List.Item><Button type={p.projectId === project?.projectId ? 'primary' : 'link'} disabled={busy} onClick={() => void action(() => openProject(p.projectId))}>{p.name}</Button><Text>{p.status}</Text></List.Item>} />
          {cursor && <Button disabled={busy} onClick={() => void action(() => loadProjects(cursor))}>加载更多项目</Button>}
        </Card>
        <Card title="创建图片分类项目" style={{ marginTop: 16 }}>
          <Form layout="vertical" onFinish={values => void action(async () => {
            const created = await write<Project>('/projects', { name: values.name.trim(), description: values.description?.trim() ?? '', taskType: 'IMAGE_CLASSIFICATION' });
            await loadProjects(); await openProject(created.projectId); setNotice('项目创建成功，请建立分类规范');
          })}>
            <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, max: 120 }]}><Input maxLength={120} /></Form.Item>
            <Form.Item name="description" label="项目说明"><Input.TextArea maxLength={4000} /></Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>创建项目</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={17}>
        {!project ? <Card><Empty description="选择或创建一个项目开始" /></Card> : <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card title={project.name}><Text copyable>{project.projectId}</Text><Paragraph>状态：{project.status} · {project.taskType}</Paragraph>
            {project.taskType !== 'IMAGE_CLASSIFICATION' ? <Alert type="warning" message="此页面仅支持图片分类项目" /> : <>
              {latestSpec && <Alert message={`当前规范：${latestSpec.labels.map(label => label.name).join('、')}`} description={latestSpec.instructions} />}
              <Form layout="vertical" onFinish={() => void action(async () => {
                const names = labelNames.split('\n').map(name => name.trim()).filter(Boolean);
                if (!names.length || new Set(names).size !== names.length) throw new Error('至少填写一个类别，类别名称不能重复');
                await write(`/projects/${id(project.projectId)}/spec-versions`, {
                  taskType: 'IMAGE_CLASSIFICATION', labels: names.map((name, index) => ({ id: `category-${index + 1}`, name })), instructions,
                  schemaVersion: '1', editorConfig: { template: 'image-classification', fromName: 'category', toName: 'image' },
                });
                setProject(await labelingJson<Project>(`/projects/${id(project.projectId)}`)); setNotice('分类规范已创建');
              })}>
                <Form.Item label="新规范类别（每行一个）"><Input.TextArea value={labelNames} onChange={e => setLabelNames(e.target.value)} /></Form.Item>
                <Form.Item label="标注说明"><Input.TextArea value={instructions} maxLength={10000} onChange={e => setInstructions(e.target.value)} /></Form.Item>
                <Button htmlType="submit" disabled={busy || project.status !== 'DRAFT'}>建立规范版本</Button>
              </Form>
            </>}
          </Card>
          <Card title="图片压缩包导入与预览">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text type="secondary">当前支持 ZIP 中的 JPEG/PNG，容量以服务端配置为准。当前整包 SHA-256 在浏览器内计算，大包请先用小样例联调；需要 HTTPS 或 localhost。</Text>
              <input aria-label="选择图片压缩包" type="file" accept=".zip" disabled={busy} onChange={e => { setFile(e.target.files?.[0]); }} />
              <Space wrap>
                <Button type="primary" disabled={busy || !file || project.taskType !== 'IMAGE_CLASSIFICATION'} onClick={() => void action(async () => {
                  if (!file) return;
                  const abort = new AbortController(); controller.current = abort;
                  if (!file.name.toLowerCase().endsWith('.zip') || file.size === 0) throw new Error('请选择非空 ZIP 文件');
                  const digest = await sha256(file);
                  abort.signal.throwIfAborted();
                  let current = batch;
                  if (!current) {
                    current = await write<Batch>(`/projects/${id(project.projectId)}/imports`, { filename: file.name, sizeBytes: file.size, sha256: digest });
                    setBatch(current); setBatchInput(current.batchId);
                  }
                  current = await queryBatch(current.batchId);
                  if (current.sizeBytes !== file.size) throw new Error('所选文件大小与原批次不符，请选择原 ZIP');
                  if (current.status !== 'UPLOADING') throw new Error('该批次已完成上传，请查询解析状态或新建批次');
                  await uploadChunks(current, file, abort.signal, bytes => setProgress(Math.round(bytes / file.size * 100)));
                  abort.signal.throwIfAborted();
                  await write(`/imports/${id(current.batchId)}/complete`);
                  await queryBatch(current.batchId); setNotice('上传完成，自动查询解析状态；READY 后读取图片列表');
                })}>上传 / 继续原文件</Button>
                <Button disabled={!busy} onClick={() => controller.current?.abort()}>停止上传</Button>
                <Button disabled={busy} onClick={() => { setBatch(undefined); setBatchInput(''); setSamples([]); setSelected(undefined); setProgress(0); }}>新建导入批次</Button>
              </Space>
              <Progress percent={progress} />
              <Input aria-label="导入批次 ID" placeholder="batchId（可粘贴已有批次恢复查询）" value={batchInput} disabled={busy} onChange={e => setBatchInput(e.target.value)} />
              <Space wrap><Button disabled={busy || !batchInput.trim()} onClick={() => void action(async () => { setSamples([]); setSelected(undefined); await queryBatch(batchInput.trim()); })}>查询解析状态</Button>
                <Button disabled={busy || batch?.status !== 'READY'} onClick={() => void action(() => loadSamples())}>读取图片列表</Button>
                <Button disabled={busy || batch?.status !== 'FAILED' || !batch.originalComplete} onClick={() => void action(async () => { await write(`/imports/${id(batch!.batchId)}/retry`); await queryBatch(batch!.batchId); })}>重试解析</Button></Space>
              {batch && <Text>批次：{batch.batchId} · {batch.status} · 已收 {batch.receivedBytes} 字节 · 有效图片 {batch.validSampleCount} · 错误 {batch.errorCount} {batch.errorCode}</Text>}
              {Boolean(batch?.errorCount) && <Alert type="warning" showIcon message={`解析发现 ${batch!.errorCount} 个问题，以下显示服务端返回的 ${batch!.errors?.length ?? 0} 条`} description={<List size="small" dataSource={batch!.errors ?? []} renderItem={issue => <List.Item>{issue.sourcePath || '压缩包'} · {issue.code} · {issue.message}</List.Item>} />} />}
              <List dataSource={samples} renderItem={sample => <List.Item><Button disabled={busy} onClick={() => { setAssignment(''); setItems([]); selectSample(sample); }}>{sample.sourcePath ?? sample.relativePath ?? sample.sampleId}</Button></List.Item>} />
              {sampleCursor && <Button disabled={busy} onClick={() => void action(() => loadSamples(sampleCursor))}>更多图片</Button>}
            </Space>
          </Card>
          <Card title="本人分类任务 · 待领取接口联调">
            <Alert type="warning" message="项目图片预览是只读。分类保存需要本人有效 assignmentId；请由业务后端提供真实领取记录。标签模板需与编辑器负责人确认，当前不自动打开 Label Studio。" />
            <Space.Compact style={{ width: '100%', marginTop: 12 }}><Input placeholder="本人 assignmentId" aria-label="本人领取记录 ID" value={assignmentInput} disabled={busy} onChange={e => setAssignmentInput(e.target.value)} /><Button disabled={busy} onClick={() => void action(() => loadAssignment())}>读取任务</Button></Space.Compact>
            <List dataSource={items} renderItem={item => <List.Item><Button disabled={busy} onClick={() => selectSample(item)}>{item.sourcePath ?? item.relativePath ?? item.sampleId}</Button></List.Item>} />
            {itemCursor && <Button disabled={busy} onClick={() => void action(() => loadAssignment(itemCursor))}>更多任务图片</Button>}
            {selected && <>
              <Title level={4}>{selected.sourcePath ?? selected.relativePath ?? selected.sampleId}</Title>
              {imageError && <Alert type="error" message={imageError} />}
              {image ? <img src={image} alt={selected.sourcePath ?? selected.sampleId} style={{ maxWidth: '100%', maxHeight: 460, objectFit: 'contain', display: 'block', marginBottom: 16 }} /> : <Text>图片尚未加载</Text>}
              <Radio.Group disabled={busy || !editable} value={choice} onChange={e => { setChoice(e.target.value); setNotice(''); }} options={labels.map(label => ({ label: label.name, value: label.name }))} />
              <Paragraph type="secondary">{editable ? '可保存本人草稿' : '只读预览，或接口缺少 editable=true / 匹配的 specVersionId'} · 当前版本 {draft?.revision ?? 0}</Paragraph>
              <Button type="primary" disabled={busy || !editable || !image || !labels.some(label => label.name === choice)} onClick={() => void action(async () => {
                const saved = await labelingJson<Draft>(`/assignments/${id(assignment)}/drafts/${id(selected.sampleId)}`, { method: 'PUT', body: JSON.stringify({
                  baseRevision: draft?.revision ?? 0, explicitDone: true, resultFormat: 'label-studio-json',
                  result: [{ from_name: 'category', to_name: 'image', type: 'choices', value: { choices: [choice] } }],
                }) });
                if (!Number.isInteger(saved.revision)) throw new Error('保存响应缺少 revision，请重新读取任务确认结果');
                const value = { ...saved, result: [{ value: { choices: [choice] } }] };
                setDraft(value); setItems(previous => previous.map(item => item.sampleId === selected.sampleId ? { ...item, draft: value } : item));
                setNotice(`分类草稿已保存至后端，版本 ${saved.revision}；尚未整包提交`);
              })}>保存分类草稿</Button>
            </>}
          </Card>
        </Space>}
      </Col>
    </Row>
  </main>;
}
