// CNCFORGE ERP — desktop entry point.
// All setup lives in lib.rs so the crate can also be linked as a library (Tauri convention).
fn main() {
    cncforge_erp_lib::run()
}
