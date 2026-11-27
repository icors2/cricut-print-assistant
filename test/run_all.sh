#!/usr/bin/env bash
# Runs every test in order and stops at the first failure. Run from anywhere: test/run_all.sh
set -euo pipefail
cd "$(dirname "$0")"
python3 ../build.py
[ -f samples/star_sticker.png ] || python3 make_samples.py
[ -f samples/scene/bear_headset.png ] || python3 make_scene.py
mkdir -p ../sample_output
run() { echo "=== $*"; "$@"; }
run node sim_cal.js
run node sim_wizard.js
run node run_test.js
run python3 verify.py
run node cal_ui_test.js
run python3 check_comp_pdf.py
run node cal_safeguard_test.js
run node cal_swap_test.js
run node cal_scale_test.js
run node persist_test.js
run node proj_test.js
run node drag_test.js
run node mock_test.js
run node mock_resize_test.js
run node mock_bg_test.js
run node mock_send_test.js
run node mock_steps_test.js
run node mock_save_test.js
run node mock_warp_test.js
run node modules_test.js
run node touch_test.js
run node pwa_test.js
run node ipad_quirks_test.js
run node ../tools/build_assets.js --check
run node assets_validator_test.js
run node assets_loader_test.js
run node assets_ui_test.js
run node assets_add_test.js
run node packs_test.js
run node remote_packs_test.js
run node pages_function_test.mjs
run node recolor_test.js
run node color_ui_test.js
run node avatar_compose_test.js
run node avatar_ui_test.js
run node avatar_export_test.js
run node avatar_pack_test.js
run node avatar_raster_test.js
if git ls-files | grep -E 'cpapack|private/' ; then echo 'private pack files must not be committed'; exit 1; fi
run node shot.js
echo "ALL TESTS PASSED"
