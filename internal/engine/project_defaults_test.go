package engine

import (
	"testing"

	"agentflow/internal/domain"
	"agentflow/internal/repo"
)

// 项目级默认执行器与模型的解析顺序：
// 节点 > 角色 > 项目默认 > 内置兜底。
//
// 这条链路决定「项目所有者统一模型口径」是否真的生效，也保证在所有者没配置
// 时行为与改造前完全一致，所以两种情况都覆盖。
func TestResolveNodeExecutorProjectDefaults(t *testing.T) {
	s, err := repo.OpenTest()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	project := domain.Project{ID: "proj-defaults", Name: "Defaults", DefaultExecutorID: "opencode", DefaultModel: "gw-model"}
	if err = s.PutProject(project); err != nil {
		t.Fatal(err)
	}

	// 1. 角色和节点都没指定 → 用项目默认
	got, err := resolveNodeExecutorForProject(s, domain.WorkflowNode{AgentID: "a"}, domain.AgentDefinition{ID: "a"}, "proj-defaults")
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "opencode" {
		t.Fatalf("executor kind = %q, want opencode from project default", got.Kind)
	}
	if got.Model != "gw-model" {
		t.Fatalf("model = %q, want gw-model from project default", got.Model)
	}

	// 2. 角色显式配置优先于项目默认
	got, err = resolveNodeExecutorForProject(s, domain.WorkflowNode{AgentID: "a"},
		domain.AgentDefinition{ID: "a", ExecutorID: "codebuddy", Model: "role-model"}, "proj-defaults")
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "codebuddy" {
		t.Fatalf("role executor must win, got %q", got.Kind)
	}
	if got.Model != "role-model" {
		t.Fatalf("role model must win, got %q", got.Model)
	}

	// 3. 角色只指定执行器、未指定模型 → 执行器默认，不回落到项目模型以外的东西
	got, err = resolveNodeExecutorForProject(s, domain.WorkflowNode{AgentID: "a"},
		domain.AgentDefinition{ID: "a", ExecutorID: "codex"}, "proj-defaults")
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "codex" {
		t.Fatalf("role executor must win, got %q", got.Kind)
	}
	if got.Model == "role-model" {
		t.Fatal("model must not leak from a previous case")
	}

	// 4. 项目没有配置默认值 → 行为与改造前一致（codebuddy）
	plain := domain.Project{ID: "proj-plain", Name: "Plain"}
	if err = s.PutProject(plain); err != nil {
		t.Fatal(err)
	}
	got, err = resolveNodeExecutorForProject(s, domain.WorkflowNode{AgentID: "a"}, domain.AgentDefinition{ID: "a"}, "proj-plain")
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "codebuddy" {
		t.Fatalf("unset project must fall back to codebuddy, got %q", got.Kind)
	}

	// 5. 不传 projectID 时等价于旧函数
	old, err := resolveNodeExecutor(s, domain.WorkflowNode{AgentID: "a"}, domain.AgentDefinition{ID: "a"})
	if err != nil {
		t.Fatal(err)
	}
	if old.Kind != "codebuddy" {
		t.Fatalf("legacy path must stay codebuddy, got %q", old.Kind)
	}
}
