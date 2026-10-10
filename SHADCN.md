# shadcn/ui の生成物と更新方針

## カスタマイズの範囲

2026-10-10 に shadcn CLI **4.21.1** と、その日に取得した公式 **base-nova / Base UI** レジストリを比較した。
書式・lint による変更を除くと、生成 UI 23 ファイルのうち **22 ファイルの独自変更は `cn` の import 接続先だけ**で、`chart.tsx` の製品固有のカスタマイズはない。
公式の設定変換を適用した比較では、生成コンポーネントの JSX 構造・クラス文字列・処理に、それ以外の差分は検出されなかった。
ツールチェーン更新後の `chart.tsx` には、型付き lint が要求する文字列補間3箇所の `String(...)` 明示化だけが追加されている。
これは従来の文字列補間と同じ変換であり、色・構造・Chart の処理を差し替える製品固有の変更ではない。
見た目や既存画面との互換性の調整は、主に生成物の外側のテーマ、ラッパー、画面構成に置いている。
「アプリの表示が公式デモと同じ」という意味ではない。

## 生成設定

正本は [`components.json`](components.json)。

| 項目          | 設定と意味                                                                |
| ------------- | ------------------------------------------------------------------------- |
| style         | `base-nova`。Radix 版や旧 `new-york` と混ぜない                           |
| React         | `rsc: true`, `tsx: true`。公式の client directive を維持                  |
| Tailwind      | v4、`config: ""`、`cssVariables: true`、`baseColor: neutral`、prefix なし |
| 出力先        | `aliases.ui: @/components/generated`                                      |
| 共通 utility  | `aliases.utils: @/lib/utils`                                              |
| hooks         | `aliases.hooks: @/hooks`                                                  |
| アイコン等    | `lucide`、`rtl: false`、`menuColor: default`、`menuAccent: subtle`        |
| CSS           | `src/web/styles/shadcn.css`                                               |
| 追加 registry | なし                                                                      |

これらは公式生成器への入力であり、生成後の独自ロジック変更とは区別する。
公式レジストリの `IconPlaceholder` から Lucide への変換、`cn-font-heading` から `font-heading` への変換、menu/RTL マーカーの処理、内部 import の出力先への書き換えは、設定に応じた生成処理である。

## 生成ファイル一覧

`src/web/components/generated/` は **24 ファイル**で、内訳は公式 UI ソース **23** とアプリ独自テスト **1**。
次の名前はすべて同ディレクトリ内の `.tsx` ファイルを指す。

| ファイル                                                               | 公式生成結果に対する独自変更                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `alert`, `avatar`, `badge`, `button`, `card`                           | `cn` の import 接続のみ                                                             |
| `checkbox`, `dialog`, `dropdown-menu`, `empty`, `field`                | `cn` の import 接続のみ                                                             |
| `input`, `label`, `popover`, `select`, `separator`                     | `cn` の import 接続のみ                                                             |
| `sheet`, `sidebar`, `skeleton`, `table`, `tabs`, `textarea`, `tooltip` | `cn` の import 接続のみ                                                             |
| `chart`                                                                | 独自ロジック変更なし。`cn` パッケージを直接 import。文字列補間3箇所の lint 対応のみ |
| `generated.test`                                                       | 公式生成物ではない。アプリの SSR、フォーム、クラス結合、設定の統合テスト            |

生成 hook は [`src/web/hooks/use-mobile.ts`](src/web/hooks/use-mobile.ts) の **1 ファイル**で、768px の判定と `matchMedia` の購読を含めて公式結果と一致する。
UI と hook を合わせた公式由来ソースは **24 ファイル**、独自テストを含めた対象総数は **25 ファイル**。

### 残すべき import 接続

上表の 22 ファイルでは、公式の `import { cn } from 'cn'` を `import { cn } from '@/lib/utils'` に変更し、理由をファイル内コメントに記載している。
[`src/web/lib/utils.ts`](src/web/lib/utils.ts) は `export { cn } from 'cn'` だけで、独自のクラス結合実装ではない。
したがって現在は同じライブラリに接続する間接化であり、公式の結合処理を差し替えてはいない。
`chart.tsx` にこの変更を機械的に追加する必要はない。

## 生成物の外側で維持する調整

| 所在                                              | プロジェクト側の責務                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/web/styles/shadcn.css`                       | Tailwind/shadcn の基盤に既存テーマを接続。dark variant に `.dark` と `[data-theme="dark"]` の両方を認識させ、`--font-sans` を既存 font token に、heading を sans に接続                                                                                              |
| 同 CSS の色接続                                   | `--background` → `--bg`、foreground → `--text`、card/popover/secondary/muted → `--surface`、primary/ring/sidebar-primary → `--accent`、destructive → `--danger-text`、sidebar → `--nav-bg` 等。`--color-accent` は `--secondary` に接続して製品の強調色 token と分離 |
| `src/web/styles/app.css`, `tokens.css`            | `shadcn.css` → `tokens.css` → `global.css` の import 順、IBM Plex Sans、製品の明暗色、ページ gutter、端まで広がる ProjectNav、Wiki の内側 padding を維持                                                                                                             |
| `src/web/components/Shell.tsx`, `ProjectNav.tsx`  | 生成 Sidebar/Tabs 等の組み合わせ、製品ナビゲーション、テーマの border token による区切り                                                                                                                                                                             |
| `src/web/features/planning/flow-charts.tsx`       | 公式 Chart を使う7種類の Recharts 構成。Throughput、CFD、Bug share、Review latency、WIP、Arrival vs completion、Aging WIP を提供。ラベル、token 色、UTC 日付、duration/percent、空状態はアプリが指定                                                                 |
| `src/web/features/projects/ProjectFlowCharts.tsx` | planning と同じ Throughput/CFD を再利用し、Overview と Metrics の描画・生の件数の意味を共有                                                                                                                                                                          |
| Wiki の Markdown 境界                             | Comark の動的 Markdown、安全性、全幅 table と描画境界内の overflow は画面側の責務。生成 `table.tsx` の改変ではない                                                                                                                                                   |

CSS はローカルの接続コードを読んで責務を分類したもので、過去の公式初期化 CSS との完全一致を証明したものではない。
Chart の公式 `THEMES` は `.dark` のままであるが、現在のアプリは色を `var(--accent)`、`var(--text-muted)`、`var(--chart-seq-*)` 等として渡している。
これらの CSS 変数は `tokens.css` の `[data-theme]` と、属性がない場合の `prefers-color-scheme` で解決されるため、生成 Chart を変更せずに製品の明暗色へ追従する。
CFD は累積済み値ではなく各状態の生の件数を Recharts で一度だけ積み上げ、linear の面を描く。
WIP は数値の time 軸、Aging WIP は ID 由来の安定した jitter と p50/p90 の guide line を使う。
これらは生成 `chart.tsx` のカスタマイズではなく、アプリ側のデータ・チャート構成である。

### 互換ラッパー

`src/web/components/ui/` には **10 ソース + `adapters.test.tsx`** がある。
これらは公式レジストリの生成対象ではなく、既存 API を維持するアプリコード。

| ラッパー                      | 維持する振る舞い                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button.tsx`                  | `primary`/`danger` を公式 variant に変換。`class`、anchor/span、既定 `type="button"` を維持                                                                                           |
| `Badge.tsx`, `Card.tsx`       | outline badge と呼び出し側の色、カードの padding・リンク・hover を構成                                                                                                                |
| `Dialog.tsx`                  | `open`/`onClose`、隠し title、内容の高さ・幅・scroll を構成。modal 制御は Base UI                                                                                                     |
| `Field.tsx`, `Input.tsx`      | label/help/error/required、`class` と `inputRef` を公式部品へ接続。Input ファイルは Textarea も提供                                                                                   |
| `Select.tsx`                  | options/value/onChange を接続し、表示 label・整列・大文字化を構成。独自 dropdown state は持たない                                                                                     |
| `Table.tsx`, `EmptyState.tsx` | 既存名・muted cell・border token、空状態の title/description/action/icon を構成                                                                                                       |
| `Popover.tsx`                 | 座標指定と caller 管理の表示状態を維持。生成 root と Base UI の Portal/Positioner/Popup を直接組み合わせ、focus の自動移動を無効化。生成 Content が座標 anchor を渡せないための互換層 |

## 安全な更新手順

1. `components.json`、この一覧、対象ソースの独自コメントを読む。CLI と runtime dependencies の更新だけではコピー済みソースは更新されない。
2. 依存の最小 release age を守って更新候補を選ぶ。CLI の版、取得日、対象レジストリを記録する。
3. まず `nix develop --command vp exec shadcn view <component>` で公式ソースを読む。応答は ignored `tmp/shadcn-audit/` に保存し、アプリへの `add --overwrite` は最初から実行しない。
4. 生成が必要なら `tmp/` の隔離した出力先と設定を使う。アプリの deps/config を変更したり install したりせず、公式の icon/font/menu/RTL/import 変換後の結果と比較する。
5. 引用符、改行、末尾 comma、import 整列等を除いて差分を見る。22 ファイルの utility 接続とコメントを保持し、必要な公式変更だけを取り込む。`ui/`、CSS、hook、独自テストを生成ファイルとして上書きしない。
6. 更新した部品に対応する `generated.test.tsx` / `ui/adapters.test.tsx`、必要なら Shell や画面の既存テストを確認する。実装更新時の標準入口は `nix develop --command vp run ci`。modal focus、選択、mobile sidebar、明暗テーマ、table overflow 等、影響のある UI 操作も確認する。
7. 本ファイルの版・取得日・一覧・独自差分を同じ変更で更新する。監査用 JSON や一時スクリプトはコミットしない。

## 比較の根拠と限界

- 取得日: **2026-10-10**。CLI: **shadcn 4.21.1**。`view` で UI 23 項目と `use-mobile` を取得し、`registry/base-nova/...` の返却 path を確認した。
- 公式データの入口: [`https://ui.shadcn.com/r/styles/base-nova/{name}.json`](https://ui.shadcn.com/r/styles/base-nova/button.json)。[Base UI Button](https://ui.shadcn.com/docs/components/base/button)、[Chart](https://ui.shadcn.com/docs/components/base/chart)、[CLI](https://ui.shadcn.com/docs/cli)、[components.json](https://ui.shadcn.com/docs/components-json) も参照。
- 比較方法: CLI 同梱 `@shadcn/registry` の `transformIcons`, `transformFont`, `transformMenu`, `transformRtl`, `transformCleanup` を比較元に適用し、内部 UI/hook import を設定の alias に正規化した。その後 TypeScript AST の node kind・literal・子構造を比較し、コメント、引用符、末尾 comma、JSX の改行由来の空白、return の括弧、lint の import 整列を除いた。
- 取得時の結果: 生の独自差分は 22 件とも `cn` → `@/lib/utils` の import だけ。この接続変更を分離すると 22 ファイルすべて一致し、Chart と hook は分離前から一致した。後続の型付き lint で Chart に追加した3箇所の文字列変換は上記のとおり別記している。実行時や見た目の検証ではなく、取得時点のソース比較の結果である。
- 一時根拠: ignored `tmp/shadcn-audit/registry.json`、`compare.mjs`、`results.txt` と AST 差分。取得 JSON の SHA-256 は `86234ceefc8d8707c50b8a955a548046d682319410d54bee58c760f636e7d469`。
- CLI の版を固定しても公開レジストリ応答は可変である。過去の全コンポーネントの生成時点の immutable snapshot は確認できていないため、今回の一致を「歴史的生成元と完全一致」とは表現しない。
- 生成ソース比較作業では依存 install、アプリソース変更、build、ブラウザ/E2E、deploy は行っていない。
