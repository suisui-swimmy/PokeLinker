# AGENTS.md

このファイルは、PokeLinker リポジトリで AI エージェントや Codex が作業するときの前提・設計意図・実装ルールをまとめたものです。
作業前に必ず読み、既存の小さな拡張機能としての構成を壊さない方針で変更してください。

## Project Overview

PokeLinker は、「ポケモン徹底攻略」の各ポケモン図鑑ページに、外部サイト「ポケモンバトルデータベース」へのリンクUIを追加する Google Chrome / Microsoft Edge 向け拡張機能です。

主な目的は次の通りです。

- 徹底攻略の図鑑ページを見ながら、対象ポケモンのバトルデータベースページをすぐ開けるようにする。
- シングル / ダブルのルール選択を、図鑑ページ上の小さなUIから切り替えられるようにする。
- シーズン選択を保存し、ページ遷移後も同じ設定を再利用できるようにする。

このプロジェクトは大規模なWebアプリではなく、Manifest V3 の content script を中心にした軽量なブラウザ拡張です。
変更はできるだけ小さく、ページ側のDOM変更に強い実装を優先してください。

## Current Repository Structure

現時点の主要ファイルは以下です。

- `manifest.json`
  - Manifest V3 の拡張機能設定。
  - `storage` 権限を使い、ユーザーの選択したルール・シーズンを `chrome.storage.local` に保存する。
  - `content.js` を徹底攻略の対象ページへ注入する。
- `content.js`
  - PokeLinker 本体。
  - ページから全国図鑑番号・フォルム情報を読み取り、PBDB URL を生成する。
  - シングル / ダブル、シーズン選択、PBDBリンクのUIを生成する。
  - 設定保存、初期化リトライ、DOM挿入、リンク更新を担当する。
- `README.md`
  - ユーザー向けの概要、機能、インストール手順。
- `icons/`
  - 拡張機能アイコン。
- `README_1.png`
  - README用のスクリーンショット。

npm / Vite / React などのビルド環境は前提にしないでください。
基本的には、素の JavaScript / HTML DOM API / CSS を使う拡張機能として扱います。

## Current Manifest Behavior

`manifest.json` では、以下のページに `content.js` を注入します。

```json
"matches": [
  "https://yakkun.com/sv/zukan/n*",
  "https://yakkun.com/ch/zukan/n*"
]
````

つまり、徹底攻略の SV 図鑑ページとチャンピオンズ図鑑ページの両方が注入対象です。
ただし、現在の `content.js` はリンク先URL・リンク表示・シーズン一覧などが SV版バトルデータベース前提になっているため、チャンピオンズ版対応ではこの差分を明確に分離してください。

## Current Implementation Model

`content.js` は `PokeLinker` クラスを中心に構成されています。

大まかな処理の流れは次の通りです。

1. `DOMContentLoaded` 後、またはすでに読み込み済みなら即時に `initializePokeLinker()` を実行する。
2. 既存インスタンスがあれば `destroy()` でDOM・タイマー・Observerを片付ける。
3. 新しい `PokeLinker` インスタンスを作成する。
4. `init()` 内で共通スタイルを注入する。
5. ページタイトル周辺を探し、PokeLinker のUIを挿入する。
6. `chrome.storage.local` から保存済み設定を読み込む。
7. ページ内の全国図鑑番号・フォルム位置を読み取る。
8. バトル種別・シーズン・ポケモンIDから PBDB URL を作る。
9. 条件が揃ったらリンクを有効化する。
10. 描画タイミングのズレに備えて、リトライと `IntersectionObserver` でリンク更新を補助する。

## Important Existing Concepts

### Settings

保存している設定は以下です。

* `battleType`

  * `single`
  * `double`
  * `null`
* `season`

  * 文字列として扱う。
  * `select` 要素や `chrome.storage.local` と合わせるため、数値ではなく文字列に統一する。

### Rule Mapping

現在のSV版PBDBでは以下の対応です。

* `single` -> `rule=0`
* `double` -> `rule=1`

チャンピオンズ版で同じ仕様かは、実装時に実URLで確認してください。
未確認のまま既存ルールを流用しないでください。

### Season Handling

現在のSV版では、シーズン自動更新を止めています。

* `SEASON_AUTO_UPDATE_ENABLED = false`
* `FINAL_SEASON = 41`
* `FIXED_SEASON_OPTIONS` に固定シーズン一覧を持つ。

SV版ランクバトルのシーズン更新が終了した前提の実装です。
チャンピオンズ版では、シーズン体系が異なる可能性が高いため、SV版の固定シーズン一覧へ無理に混ぜないでください。

推奨方針:

* SV版とチャンピオンズ版で season provider を分ける。
* URL生成処理とシーズン一覧生成処理を、ゲーム種別ごとに分離する。
* `latest` や `最新` のような表示を使う場合も、内部的には実際に解決されるシーズン番号を明確にする。

### Pokemon Info Extraction

現在は徹底攻略ページから以下を取得しています。

* 全国図鑑番号

  * `td.c1` のうち、`全国No.` を含むセルを探し、その次のセルから取得する。
  * PBDB用に4桁ゼロ埋めする。
* フォルム番号

  * `ul.select_list` のうち、`フォルム:` ラベルを持つリストを探す。
  * 現在ページのフォームは `<strong>` を含む `li` として判定する。
  * 並び順から `00`, `01`, `02` のような2桁番号へ変換する。

注意点:

* URLパスの `n741p` のような末尾文字を、全国図鑑番号やフォルム番号として雑に扱わないでください。
* 徹底攻略側のDOM構造は変更される可能性があるため、取得できない場合はリンクを無効化し、例外でページを壊さないようにしてください。
* フォルム順とバトルデータベース側の識別番号が常に一致するとは限らないため、例外が出たら個別マッピングを検討してください。

## URL Generation Policy

現在のSV版リンク形式は以下です。

```text
https://sv.pokedb.tokyo/pokemon/show/{nationalNumber}-{formIndex}?season={season}&rule={rule}
```

例:

```text
https://sv.pokedb.tokyo/pokemon/show/0741-00?season=41&rule=1
```

チャンピオンズ版対応では、URL生成を直接テンプレート文字列へ埋め込まず、次のような責務へ分けることを推奨します。

* 現在ページが SV か CH か判定する。
* 対象ゲームに対応する PBDB base URL を選ぶ。
* 対象ゲームに対応するシーズン一覧を選ぶ。
* 対象ゲームに対応する rule / mode パラメータを選ぶ。
* ポケモンIDとフォルムIDを組み合わせる。

避けること:

* `updatePBDBLink()` の中に SV / CH の分岐を何十行も直接増やす。
* SV版の `FINAL_SEASON = 41` をチャンピオンズ版にも流用する。
* 未確認のチャンピオンズ版URLを確定仕様としてコメントに書く。

## Recommended Refactor Direction for Champions Support

チャンピオンズ版対応では、まず既存挙動を壊さずに、設定・URL生成・UI表示の分岐点を作ってください。

推奨する小さな分割例:

```js
const GAME_CONFIGS = {
  sv: {
    label: 'SV',
    pagePattern: '/sv/zukan/',
    linkText: 'PBDB(SV)',
    baseUrl: 'https://sv.pokedb.tokyo/pokemon/show/',
    rules: {
      single: '0',
      double: '1',
    },
  },
  ch: {
    label: 'Champions',
    pagePattern: '/ch/zukan/',
    linkText: 'PBDB(CH)',
    baseUrl: null,
    rules: {
      single: null,
      double: null,
    },
  },
};
```

`ch.baseUrl` や `ch.rules` は、実際のチャンピオンズ版バトルデータベースURLを確認してから埋めてください。
仮実装する場合は、リンクを有効化せず、UI上でも未対応状態が分かるようにしてください。

## UI Policy

現在のUIは、ページタイトル直下に次の要素を横並びで追加します。

```text
[ ] シングル  [ ] ダブル  シーズン: [select]  PBDB(SV)↗
```

UI実装の方針:

* ページ本体のレイアウトを大きく崩さない。
* 既存サイトのCSSに巻き込まれすぎないよう、クラス名は `pokelinker-` prefix を使う。
* スタイルは `createStyles()` で1回だけ挿入する。
* チェックボックスは相互排他にする。
* ルール未選択時はリンクを無効化する。
* URL生成に必要な情報が取れない場合もリンクを無効化する。
* 新しいUI要素を追加する場合も、まずは最小限にする。

チャンピオンズ版で表示文言を変える場合は、ページ種別に応じて `PBDB(SV)` / `PBDB(CH)` のように明示してください。

## Error Handling Policy

この拡張機能は第三者サイトへDOMを差し込むため、ページ側の変更に弱いです。
そのため、失敗時は以下を守ってください。

* 例外でページ全体の動作を止めない。
* `console.error` には、何に失敗したか分かる短い日本語メッセージを残す。
* 必須情報が取れない場合は `null` を返し、リンクを有効化しない。
* 初期化失敗時は既存インスタンスを `destroy()` してからリトライする。
* タイマー、Observer、挿入DOMは `destroy()` で片付ける。

## Storage / Compatibility Policy

既存ユーザーの保存設定を壊さないでください。

現在のキー:

* `battleType`
* `season`

チャンピオンズ版でSV版と異なるシーズンを保存する必要がある場合は、次のようにゲーム別キーへ移行することを検討してください。

* `settingsByGame.sv.season`
* `settingsByGame.ch.season`
* `battleType` は共通で維持する、または `settingsByGame` に含める。

移行処理を入れる場合は、既存の `battleType` / `season` を読み取れる後方互換を残してください。

## Coding Guidelines

* 既存の素の JavaScript スタイルに合わせる。
* TypeScript / React / bundler を導入しない。
* 外部ライブラリを追加しない。
* ファイルパスはリポジトリ相対で記述する。
* Windowsの絶対パスや個人ユーザー名をドキュメントへ書かない。
* DOMセレクタは、意味が分かるコメントを添える。
* 既存のSV版挙動を変更するときは、変更理由をコメントまたはPR本文に残す。
* 大きなリファクタとチャンピオンズ版対応を同時にやりすぎない。
* まず既存挙動を保ったまま分岐点を作り、その後チャンピオンズ版のURL生成を追加する。

## Manual Test Checklist

変更後は、少なくとも次を手動確認してください。

### SV page

* `https://yakkun.com/sv/zukan/n1` のようなSV図鑑ページでUIが表示される。
* シングルを選ぶと `rule=0` のリンクになる。
* ダブルを選ぶと `rule=1` のリンクになる。
* シーズン選択がリンクURLへ反映される。
* ページ再読み込み後も選択が保存されている。
* フォルム違いページで `0000-00` 部分が意図通り変わる。

### Champions page

* `https://yakkun.com/ch/zukan/n*` のページでUIが表示される。
* SV版とは別のリンク文言、URL、シーズン体系が必要な場合に混線しない。
* チャンピオンズ版URLが未確認の場合は、壊れたリンクを有効化しない。
* チャンピオンズ版URL確認後は、実際の対象ポケモンページを開ける。

### Browser

* Google Chrome の拡張機能管理画面から読み込める。
* Microsoft Edge の拡張機能管理画面から読み込める。
* コンソールに致命的なエラーが出ない。

## Release Notes Policy

ユーザー向け変更を行った場合は、必要に応じて `README.md` も更新してください。

特に以下の変更では README 更新を検討してください。

* チャンピオンズ版対応を正式に追加した。
* 対応URLや対応ブラウザが変わった。
* インストール手順が変わった。
* UI文言や使い方が変わった。

`manifest.json` の `version` は、拡張機能として配布するタイミングで更新してください。
小さな内部整理だけなら、必ずしも毎回上げる必要はありません。

## Non-goals

このプロジェクトで今すぐやらないこと:

* 大規模なUIフレームワーク化。
* バックエンド実装。
* ユーザーアカウントや同期機能。
* ポケモンデータの独自DB化。
* 徹底攻略やPBDBへの自動クロール。
* ページ内容を大量取得する処理。

PokeLinker は、あくまで「現在見ている徹底攻略ページから、対応するバトルデータベースページへ素早く移動する」ための軽量リンク補助拡張です。