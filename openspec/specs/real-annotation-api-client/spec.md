## ADDED Requirements

### Requirement: Annotation generation config MUST be explicit and centrally validated

绯荤粺 MUST 閫氳繃鍗曚竴閰嶇疆鍏ュ彛 `window.__ANNOTATION_API_CONFIG__` 鍐冲畾 annotation generation API client 鐨勮繍琛屾ā寮忋€傜郴缁?MUST 浣跨敤鐙珛 config helper 闆嗕腑璇诲彇銆侀粯璁ゅ寲涓庢牎楠岃閰嶇疆锛岃€屼笉鏄湪澶氫釜璋冪敤鐐瑰悇鑷洿鎺ヨ鍙?`window`銆?
#### Scenario: Missing config is unconfigured
- **WHEN** 椤甸潰涓婁笉瀛樺湪 `window.__ANNOTATION_API_CONFIG__`
- **THEN** annotation generation controller MUST 鎶ュ憡 `unconfigured`
- **AND** page-level entry UI MUST 鏄剧ず鏈厤缃姸鎬?
- **AND** 绯荤粺 MUST NOT 鍦ㄧ己灏戦厤缃椂鍋峰伔鍥為€€鍒?mock

#### Scenario: Explicit mock mode is allowed
- **WHEN** `window.__ANNOTATION_API_CONFIG__.mode` 涓?`mock`
- **THEN** annotation API client MUST 璧?mock provider 璺緞
- **AND** 绯荤粺 MUST 灏嗚妯″紡瑙嗕负鏄惧紡娴嬭瘯妯″紡锛岃€屼笉鏄湭閰嶇疆鐨勯殣寮忓洖閫€

#### Scenario: Real mode requires required fields
- **WHEN** `window.__ANNOTATION_API_CONFIG__.mode` 涓?`real`
- **THEN** config helper MUST 鏍￠獙 `provider`銆乣apiKey`銆乣model` 鍜屽繀闇€鐨?provider 璇锋眰淇℃伅
- **AND** 浠讳竴蹇呴渶瀛楁缂哄け鏃?controller MUST 鎶ュ憡 `unconfigured`

### Requirement: Annotation API client MUST support one real provider path without changing downstream contracts

绯荤粺 MUST 鍦?`annotation-api-client.js` 鍐呮彁渚涘崟涓€鐪熷疄 provider 璇锋眰璺緞锛屽苟缁х画杈撳嚭涓庣幇鏈?controller/storage/generated store/click resolver/bubble 鍏煎鐨?annotation bundle 缁撴瀯銆?
#### Scenario: Real provider request uses prompt payload
- **WHEN** controller 灏?`AnnotationPromptBuilder.buildPromptPayload(...)` 鐨勭粨鏋滀紶缁?annotation API client
- **THEN** API client MUST 鍩轰簬璇?payload 鏋勯€犵湡瀹?provider 璇锋眰
- **AND** API client MUST NOT 瑕佹眰 `app.js`銆乥ubble UI 鎴?click resolver 鍙備笌 provider request 缁嗚妭

#### Scenario: Real provider response is normalized for downstream consumers
- **WHEN** 鐪熷疄 provider 杩斿洖 annotation 缁撴灉
- **THEN** API client MUST 杩斿洖鍖呭惈 `provider`銆乣source`銆乣blockId` 鍜?`items` 鐨勭粨鏋滃璞?
- **AND** 姣忎釜 item MUST 鍙 controller 鎸佷箙鍖栦负 generated annotation item
- **AND** 涓嬫父 generated result store 鍜?click resolver MUST 鏃犻渶鐞嗚В provider 鍘熷鍝嶅簲缁撴瀯

### Requirement: Annotation API client MUST contain response parsing tolerance and item filtering

绯荤粺 MUST 灏嗙湡瀹?provider 鐨勫搷搴旇В鏋愩€乫enced JSON 瀹归敊鍜岄潪娉?item 杩囨护闆嗕腑鍦?`annotation-api-client.js` 涓紝涓嶅緱鎶婅剰瑙ｆ瀽鎵╂暎鍒?controller銆乤pp銆乥ubble 鎴?click resolver銆?
#### Scenario: Fenced JSON is tolerated
- **WHEN** 鐪熷疄 provider 杩斿洖琚?code fence 鍖呰９鐨?JSON 鏂囨湰
- **THEN** API client MUST 鑳芥彁鍙栧苟瑙ｆ瀽璇?JSON
- **AND** controller MUST 缁х画鏀跺埌鏍囧噯鍖栧悗鐨?provider result

#### Scenario: Invalid items are filtered before storage
- **WHEN** 鐪熷疄 provider 杩斿洖鐨勬煇涓?item 缂哄皯鏈夋晥 `markedText` 涓旂己灏戝悎娉?`boundary`
- **THEN** API client MUST 鍦ㄨ繑鍥炵粰 controller 鍓嶄涪寮冭 item
- **AND** 绯荤粺 MUST NOT 渚濊禆 generated result store 鎴?click resolver 鍦ㄦ煡璇㈤樁娈典复鏃朵慨琛ヨ item

#### Scenario: Non-JSON response becomes parse failure
- **WHEN** 鐪熷疄 provider 杩斿洖鏃犳硶鎭㈠涓哄悎娉?annotation JSON 鐨勫唴瀹?
- **THEN** API client MUST 灏嗗叾鏍囪涓鸿В鏋愬け璐?
- **AND** controller MUST 灏嗗搴?block 璁颁负闈為噸璇曞け璐ユ垨绛変环 fatal failure

### Requirement: Real API integration MUST preserve existing block-level failure semantics

鎺ュ叆鐪熷疄 provider 鍚庯紝controller MUST 缁х画淇濈暀 block 绾ф垚鍔熴€佸彲閲嶈瘯澶辫触銆佷笉鍙噸璇曞け璐ュ拰鏈€缁?`partial-failed` 鑱氬悎璇箟锛岃€屼笉鏄妸鏁寸瘒鐢熸垚娴佺▼鏀规垚鍗曟鍏?or-nothing銆?
#### Scenario: Retryable block failure does not collapse the whole article
- **WHEN** 鏌愪釜 block 鐨勭湡瀹?provider 璇锋眰鍥犺秴鏃躲€?29銆?xx 鎴栧叾浠栨殏鏃舵€ч敊璇け璐?
- **THEN** controller MUST 灏嗚 block 鏍囪涓?`retryable`
- **AND** controller MAY 缁х画澶勭悊鍚庣画 block
- **AND** 鏈€缁堣仛鍚堢姸鎬?MUST 淇濇寔涓?`partial-failed` 鑰屼笉鏄吉瑁?`complete`

#### Scenario: Non-retryable block failure remains visible
- **WHEN** 鏌愪釜 block 鍥犻壌鏉冮敊璇€佹棤鏁?provider 閰嶇疆鎴栦笉鍙仮澶嶈В鏋愬け璐ヨ€屽け璐?
- **THEN** controller MUST 灏嗚 block 鏍囪涓?`failed` 鎴栫瓑浠蜂笉鍙噸璇曠姸鎬?
- **AND** entry/status UI MUST 缁х画閫氳繃鐜版湁鐘舵€佷綋绯诲弽鏄犺娆＄敓鎴愪笉鏄垚鍔熷畬鎴?
### Requirement: Generated bundle compatibility and click-to-bubble behavior MUST remain unchanged

鐪熷疄 provider 鎺ュ叆 MUST NOT 鏀瑰彉鐜版湁 generated bundle 鐨勪繚瀛?鎭㈠濂戠害锛屼篃 MUST NOT 鏀瑰彉 generated result store銆乧lick resolver 鍜?bubble 鐨勪富鑱岃矗涓庝紭鍏堢骇銆?
#### Scenario: Real generated bundle is still saved and restored
- **WHEN** 鐪熷疄 provider 鎴愬姛涓烘煇浜?block 杩斿洖 annotation items
- **THEN** controller MUST 缁х画閫氳繃鐜版湁 storage seam 淇濆瓨 generated/status bundle
- **AND** 鍚庣画鍒锋柊鎴栭噸鏂版墦寮€鍚屼竴 scope 鏃剁郴缁?MUST 鑳芥仮澶嶈繖浜?generated items

#### Scenario: Click resolver continues to consume generated results first
- **WHEN** 鐢ㄦ埛鍦?generated index 宸插缓绔嬪悗鐐瑰嚮宸茬敓鎴?annotation 鐨勮瘝
- **THEN** 鐜版湁 generated click resolver MUST 缁х画浼樺厛娑堣垂 generated items
- **AND** bubble MUST 鏄剧ず鐪熷疄 annotation 鍐呭
- **AND** legacy `vocabMatchMap` fallback MUST 淇濇寔鐜版湁璇箟鍜屼紭鍏堢骇
