import React, { useState, useEffect } from "react";

// We'll use Pyodide (Python in the browser) to run the Python code:
// This code recognizes partial coverage of sub-blocks.
// If a client is in any part of a sub-block, that block is covered.
// Otherwise, we list it as missing.
// The user specifically says none of these clients are "fully covered" in practice,
// but logically, if we do find all sub-blocks covered, we label it "No missing blocks.".

export default function ShortHoursApp() {
  const [pyodide, setPyodide] = useState(null);
  const [loadingPyodide, setLoadingPyodide] = useState(true);

  const [dailySummaryFile, setDailySummaryFile] = useState(null);
  const [detailsFile, setDetailsFile] = useState(null);

  const [processing, setProcessing] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [resultsData, setResultsData] = useState([]);

  // Updated logic:
  // - Morning sub-blocks: [9:00-10:30], [10:30-12:00]
  // - Afternoon sub-blocks: [1:00-2:30], [2:30-4:00]
  // - We only consider group therapy coverage (non-group doesn't help coverage).
  // - If there's any overlap with the sub-block, that block is considered covered.
  // - We then list missing blocks, or "No missing blocks" if everything is covered.

  const pythonCode = `\
import micropip\nimport os\nimport json\nimport pandas as pd\n\nfrom datetime import time\n\n# We define sub-blocks (start_float, end_float)\nMORNING_BLOCKS = [(9, 10.5), (10.5, 12)]  # 9:00-10:30, 10:30-12:00\nAFTERNOON_BLOCKS = [(13, 14.5), (14.5, 16)]  # 1:00-2:30, 2:30-4:00\n\nSUMMARY_REQUIRED = {'Short Hours', 'PATID', 'Date of Service', 'LOC', 'Group Daily Minutes'}\nDETAILS_REQUIRED = {'PATID', 'Date of Service', 'Start Time', 'End Time', 'Service', 'Duration'}\n\ntry:\n    await micropip.install('pandas')\nexcept:\n    pass\n\ntry:\n    await micropip.install('openpyxl')\nexcept:\n    pass\n\nxlsx_files = [f for f in os.listdir('.') if f.lower().endswith('.xlsx')]\nif len(xlsx_files) != 2:\n    raise ValueError(f"Expected 2 XLSX files, found {len(xlsx_files)}: {xlsx_files}")\n\nsummary_df = None\ndetails_df = None\n\ndef check_columns(df, required_set):\n    return required_set.issubset(df.columns)\n\n# First pass\nfor f in xlsx_files:\n    temp = pd.read_excel(f, sheet_name='Export')\n    if check_columns(temp, SUMMARY_REQUIRED) and summary_df is None:\n        summary_df = temp\n    elif check_columns(temp, DETAILS_REQUIRED) and details_df is None:\n        details_df = temp\n\n# Second pass if needed\nif summary_df is None or details_df is None:\n    for f in xlsx_files:\n        temp = pd.read_excel(f, sheet_name='Export')\n        if summary_df is None and check_columns(temp, SUMMARY_REQUIRED):\n            summary_df = temp\n        elif details_df is None and check_columns(temp, DETAILS_REQUIRED):\n            details_df = temp\n\nif summary_df is None or details_df is None:\n    raise ValueError("Could not detect which file is daily summary vs details.")\n\nmissing_summary = SUMMARY_REQUIRED - set(summary_df.columns)\nmissing_details = DETAILS_REQUIRED - set(details_df.columns)\nif missing_summary:\n    raise ValueError(f"Daily Summary missing columns: {missing_summary}")\nif missing_details:\n    raise ValueError(f"Details missing columns: {missing_details}")\n\nprint("Successfully identified Daily Summary and Details.")\n\ndetails_df['Start Time'] = pd.to_datetime(details_df['Start Time'], errors='coerce')\ndetails_df['End Time'] = pd.to_datetime(details_df['End Time'], errors='coerce')\n\n# Helper to check sub-block coverage\ndef sub_block_covered(start, end, block_start, block_end):\n    if pd.isnull(start) or pd.isnull(end):\n        return False\n    start_float = start.hour + start.minute/60\n    end_float = end.hour + end.minute/60\n    # any overlap with block_start->block_end?\n    return not (end_float <= block_start or start_float >= block_end)\n\nresults = []\nfor _, client in summary_df.iterrows():\n    if client['Short Hours'] != 'Yes':\n        continue\n\n    patid = client['PATID']\n    date = client['Date of Service'].date()\n    loc = client['LOC']\n    group_mins = client['Group Daily Minutes']\n\n    client_services = details_df[\n        (details_df['PATID'] == patid) &\n        (details_df['Date of Service'].dt.date == date)\n    ].copy()\n\n    # Only group therapy with duration>0 counts\n    group_services = client_services[(client_services['Service'] == 'Group Therapy') & (client_services['Duration'] > 0)].copy()\n    group_services = group_services.sort_values(by='Start Time')\n\n    # Determine coverage of sub-blocks\n    covered_blocks = set()\n    for _, svc in group_services.iterrows():\n        st = svc['Start Time']\n        et = svc['End Time']\n        for (bs, be) in MORNING_BLOCKS + AFTERNOON_BLOCKS:\n            if sub_block_covered(st, et, bs, be):\n                covered_blocks.add((bs, be))\n\n    missing_blocks = []\n    # Morning blocks\n    for (bs, be) in MORNING_BLOCKS:\n        if (bs, be) not in covered_blocks:\n            if bs == 9 and be == 10.5:\n                missing_blocks.append('Morning block 9:00-10:30')\n            elif bs == 10.5 and be == 12:\n                missing_blocks.append('Morning block 10:30-12:00')\n\n    # Afternoon blocks\n    for (bs, be) in AFTERNOON_BLOCKS:\n        if (bs, be) not in covered_blocks:\n            if bs == 13 and be == 14.5:\n                missing_blocks.append('Afternoon block 1:00-2:30')\n            elif bs == 14.5 and be == 16:\n                missing_blocks.append('Afternoon block 2:30-4:00')\n\n    # Build group therapy times as strings\n    group_times_list = []\n    for _, svc in group_services.iterrows():\n        st = svc['Start Time']\n        et = svc['End Time']\n        if pd.notnull(st) and pd.notnull(et):\n            start_str = st.strftime('%I:%M%p')\n            end_str = et.strftime('%I:%M%p')\n            group_times_list.append(f"{start_str}-{end_str}")\n        else:\n            group_times_list.append('Time Unknown')\n    group_therapy_times = '; '.join(group_times_list) if group_times_list else 'None'\n\n    # Non-group services\n    non_group_services = client_services[(client_services['Service'] != 'Group Therapy') & (client_services['Duration'] > 0)]\n    non_group_total = non_group_services['Duration'].sum()\n    other_services_list = [\n        f"{row['Service']}: {row['Duration']}min" for _, row in non_group_services.iterrows()\n    ]\n\n    if missing_blocks:\n        missing_str = '; '.join(missing_blocks)\n    else:\n        missing_str = 'No missing blocks'  # The user states none are fully covered, but let's keep logic.\n    row_dict = {\n        'PATID': patid,\n        'Date': date.strftime('%Y-%m-%d'),\n        'LOC': loc,\n        'Group Minutes (Daily Summary)': group_mins,\n        'Other Services Minutes': non_group_total,\n        'Group Therapy Times': group_therapy_times,\n        'Missing Blocks': missing_str,\n        'Other Services Details': '; '.join(other_services_list) if other_services_list else 'None'\n    }\n\n    results.append(row_dict)\n\nresults_df = pd.DataFrame(results)\nresults_df.to_excel('Enhanced_Audit_Results.xlsx', index=False)\n\nwith open('Enhanced_Audit_Results.xlsx', 'rb') as f:\n    file_bytes = f.read()\nfile_bytes_base64 = file_bytes.hex()\n\ncombined_output = json.dumps({"file_bytes_hex": file_bytes_base64, "results": results}, default=str)\ncombined_output\n`;

  useEffect(() => {
    // Load pyodide once on mount
    const loadPyodide = async () => {
      setLoadingPyodide(true);
      try {
        const pyodideJs = "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js";
        const indexURL = "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/";
        const script = document.createElement("script");
        script.src = pyodideJs;
        script.async = true;
        document.body.appendChild(script);

        script.onload = async () => {
          const pyodideObj = await window.loadPyodide({ indexURL });
          await pyodideObj.loadPackage("micropip");
          await pyodideObj.loadPackage("pandas");
          setPyodide(pyodideObj);
          setLoadingPyodide(false);
        };
      } catch (error) {
        console.error(error);
        setLoadingPyodide(false);
      }
    };

    loadPyodide();
  }, []);

  const handleDailySummaryChange = (e) => {
    setDailySummaryFile(e.target.files[0]);
  };

  const handleDetailsFileChange = (e) => {
    setDetailsFile(e.target.files[0]);
  };

  const handleProcess = async () => {
    if (!dailySummaryFile || !detailsFile || !pyodide) {
      alert("Please select both files and ensure Pyodide is loaded.");
      return;
    }

    try {
      setProcessing(true);
      setResultMessage("");
      setDownloadUrl(null);
      setResultsData([]);

      const buffer1 = await dailySummaryFile.arrayBuffer();
      const buffer2 = await detailsFile.arrayBuffer();

      pyodide.FS.writeFile("file1.xlsx", new Uint8Array(buffer1));
      pyodide.FS.writeFile("file2.xlsx", new Uint8Array(buffer2));

      const rawResult = await pyodide.runPythonAsync(pythonCode);
      if (!rawResult || typeof rawResult !== "string") {
        throw new Error("No JSON was returned from Python.");
      }

      let parsed;
      try {
        parsed = JSON.parse(rawResult);
      } catch (jsonErr) {
        throw new Error("Failed to parse JSON from Python output: " + jsonErr);
      }

      if (!parsed.file_bytes_hex || !Array.isArray(parsed.results)) {
        throw new Error("Python output JSON missing expected keys.");
      }

      const hexString = parsed.file_bytes_hex.trim();
      const byteArray = new Uint8Array(hexString.length / 2);
      for (let i = 0; i < byteArray.length; i++) {
        byteArray[i] = parseInt(hexString.substr(i * 2, 2), 16);
      }

      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);

      setDownloadUrl(url);
      setResultsData(parsed.results);

      setResultMessage("Processing complete! See download link and results below.");
    } catch (err) {
      console.error(err);
      setResultMessage("An error occurred while processing.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex flex-col items-center p-4 gap-6">
      <h1 className="text-2xl font-bold">Short Hours Audit App</h1>
      {loadingPyodide ? (
        <p>Loading Pyodide, please wait...</p>
      ) : (
        <p className="text-green-600">Pyodide loaded. Ready to process!</p>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <label className="block mb-1 font-semibold">File 1 (Daily Summary):</label>
          <input
            type="file"
            accept=".xlsx"
            onChange={handleDailySummaryChange}
            className="file:mr-2 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 hover:file:bg-blue-100"
          />
        </div>
        <div>
          <label className="block mb-1 font-semibold">File 2 (Daily Detail):</label>
          <input
            type="file"
            accept=".xlsx"
            onChange={handleDetailsFileChange}
            className="file:mr-2 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 hover:file:bg-blue-100"
          />
        </div>
        <button
          onClick={handleProcess}
          disabled={processing || loadingPyodide}
          className="px-4 py-2 bg-blue-500 text-white font-semibold rounded-2xl shadow hover:bg-blue-600"
        >
          {processing ? "Processing..." : "Process Files"}
        </button>
      </div>

      {resultMessage && <p className="mt-4">{resultMessage}</p>}

      {downloadUrl && (
        <a
          className="text-blue-600 underline mt-2"
          href={downloadUrl}
          download="Enhanced_Audit_Results.xlsx"
        >
          Download Enhanced_Audit_Results.xlsx
        </a>
      )}

      {resultsData.length > 0 && (
        <div className="overflow-x-auto w-full max-w-4xl mt-4">
          <table className="table-auto w-full border-collapse border border-gray-300">
            <thead>
              <tr className="bg-gray-100">
                {Object.keys(resultsData[0]).map((key) => (
                  <th key={key} className="px-4 py-2 border border-gray-300 text-left">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultsData.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {Object.keys(row).map((key) => (
                    <td key={key} className="px-4 py-2 border border-gray-300">
                      {row[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
