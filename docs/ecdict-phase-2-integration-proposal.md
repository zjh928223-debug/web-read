# ECDICT 第二阶段接入建议（仅设计，未实施）

建议只新增单向适配器：

```text
现有扫描结果
→ DictionaryEnrichmentAdapter
→ LocalDictionaryService
→ 候选结果
→ 现有流程决定是否使用
```

适配器负责把词典的 exact、normalized 和多 lemma 候选转换为业务可理解的“建议”，
但不替词典消歧，也不允许 ECDICT 直接依赖 `VocabularyRepository`、SRS scheduler、
AI service 或 card service。

正式接入前应单独评审：

1. 查询发生在预览、用户确认还是入库之后；
2. 候选只做瞬时展示、独立缓存，还是新增不覆盖旧字段的来源模型；
3. 如何确保不覆盖已有 `meaning`、`context`、`memoryHint`；
4. normalized/lemma 多候选由谁和何时选择；
5. ECDICT 禁用、缺库或损坏时是否完全沿用现有流程；
6. 缓存版本、上游数据版本和旧记录兼容策略；
7. 对已有卡片、调度时间和复习记录的零迁移证明。

第一阶段没有创建该适配器，也没有修改任何现有调用点。
