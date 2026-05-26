use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};

mod generated_tables;
mod scanner;

use generated_tables::{RULES, VOICE_ALIASES, VOICES};
use scanner::{synthesize_with_aliases, SynthesisResult};

pub use scanner::SynthesisResult as NativeSynthesisResult;

pub fn synthesize_native(voice: &str, ipa: &str) -> SynthesisResult {
    synthesize_with_aliases(voice, ipa, RULES, VOICES, VOICE_ALIASES)
}

fn result_to_dict<'py>(py: Python<'py>, result: SynthesisResult) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new(py);
    dict.set_item("supported", result.supported)?;
    dict.set_item("voice", result.voice)?;
    dict.set_item("phonemes", result.phonemes)?;
    dict.set_item("reason", result.reason)?;
    dict.set_item("offset", result.offset)?;
    Ok(dict)
}

#[pyfunction]
fn synthesize(py: Python<'_>, voice: &str, ipa: &str) -> PyResult<Py<PyDict>> {
    let result = synthesize_native(voice, ipa);
    Ok(result_to_dict(py, result)?.unbind())
}

#[pyfunction]
fn synthesize_batch(py: Python<'_>, items: &Bound<'_, PyList>) -> PyResult<Vec<Py<PyDict>>> {
    let mut results = Vec::with_capacity(items.len());
    for item in items.iter() {
        let dict = item.downcast::<PyDict>()?;
        let voice: String = dict.get_item("voice")?.ok_or_else(|| {
            pyo3::exceptions::PyValueError::new_err("batch item missing voice")
        })?.extract()?;
        let ipa: String = dict.get_item("ipa")?.ok_or_else(|| {
            pyo3::exceptions::PyValueError::new_err("batch item missing ipa")
        })?.extract()?;
        let result = synthesize_native(&voice, &ipa);
        results.push(result_to_dict(py, result)?.unbind());
    }
    Ok(results)
}

#[pymodule]
fn _native(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(synthesize, module)?)?;
    module.add_function(wrap_pyfunction!(synthesize_batch, module)?)?;
    Ok(())
}
