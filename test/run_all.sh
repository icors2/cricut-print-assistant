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
run node shot.js
echo "ALL TESTS PASSED"
