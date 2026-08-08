import React, { useEffect, useState } from 'react';
import { FolderPlus, Trash2, Upload, FileText, ChevronRight, HardDrive, Database } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';

const CollectionManager = ({ token }) => {
  const [collections, setCollections] = useState([]);
  const [activeCol, setActiveCol] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteColId, setConfirmDeleteColId] = useState(null);
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState(null);

  const fetchCollections = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/collections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCollections(data);
      }
    } catch (err) {
      console.error(err);
      setError('Could not connect to database backend');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCollections();
  }, []);

  useEffect(() => {
    if (activeCol) {
      fetchDocuments(activeCol.id);
    } else {
      setDocuments([]);
    }
  }, [activeCol]);

  const fetchDocuments = async (colId) => {
    try {
      const res = await fetch(`${API_BASE}/api/collections/${colId}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateCollection = async (e) => {
    e.preventDefault();
    if (!newColName.trim()) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/collections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newColName, description: newColDesc }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewColName('');
        setNewColDesc('');
        fetchCollections();
      } else {
        setError(data.detail || 'Failed to create collection');
      }
    } catch (err) {
      setError('Connection failure');
    }
  };

  const handleDeleteCollection = async (id, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/api/collections/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        if (activeCol?.id === id) setActiveCol(null);
        setConfirmDeleteColId(null);
        fetchCollections();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const [uploadProgress, setUploadProgress] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.items && activeCol) {
      const files = [];
      const queue = [];
      
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            queue.push(traverseFileTree(entry, files));
          }
        }
      }
      
      await Promise.all(queue);
      await processAndUploadFiles(files);
    }
  };

  const traverseFileTree = (item, fileList) => {
    return new Promise((resolve) => {
      if (item.isFile) {
        item.file((file) => {
          Object.defineProperty(file, 'webkitRelativePath', {
            value: item.fullPath.substring(1),
            writable: true
          });
          fileList.push(file);
          resolve();
        });
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        dirReader.readEntries(async (entries) => {
          const entriesQueue = [];
          for (let i = 0; i < entries.length; i++) {
            entriesQueue.push(traverseFileTree(entries[i], fileList));
          }
          await Promise.all(entriesQueue);
          resolve();
        });
      }
    });
  };

  const processAndUploadFiles = async (filesList) => {
    if (!filesList || filesList.length === 0 || !activeCol) return;
    setUploading(true);
    setError(null);

    let successCount = 0;
    let failCount = 0;
    let errorDetails = [];

    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      if (file.name === '.' || file.name === '..' || file.size === 0) continue;

      setUploadProgress(`Processing ${i + 1} of ${filesList.length}: "${file.name}"...`);

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(`${API_BASE}/api/collections/${activeCol.id}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (res.ok) {
          successCount++;
        } else {
          const errData = await res.json();
          console.error(`Upload failed for ${file.name}:`, errData);
          failCount++;
          errorDetails.push(errData.detail || `Upload failed for ${file.name}`);
        }
      } catch (err) {
        console.error(`Network error uploading ${file.name}:`, err);
        failCount++;
        errorDetails.push(`Network error for "${file.name}"`);
      }
    }

    setUploadProgress('');
    setUploading(false);
    fetchDocuments(activeCol.id);
    fetchCollections();

    if (errorDetails.length > 0) {
      setError(`Successfully indexed ${successCount} files. Issues:\n` + errorDetails.join('\n'));
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    await processAndUploadFiles(files);
    e.target.value = null;
  };

  const handleDeleteDoc = async (docId) => {
    try {
      const res = await fetch(`${API_BASE}/api/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setConfirmDeleteDocId(null);
        fetchDocuments(activeCol.id);
        fetchCollections();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-950/20 p-6 md:p-8 overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-300 transition-colors duration-300">
      {/* Title */}
      <div className="flex items-center gap-2.5 mb-8 select-none">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-650 dark:text-indigo-400 shadow-md">
          <HardDrive className="w-5.5 h-5.5" />
        </div>
        <div className="text-left">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white tracking-wide">Knowledge Base Manager</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-550 font-medium -mt-0.5">Manage data sources, document ingestions, and vector segments</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 text-xs font-semibold bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-455 rounded-2xl animate-in fade-in duration-200 whitespace-pre-wrap">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Side: Create & List Collections */}
        <div className="lg:col-span-1 space-y-6">
          <form onSubmit={handleCreateCollection} className="p-5 bg-white dark:bg-zinc-900/30 backdrop-blur-md border border-zinc-200 dark:border-zinc-900 rounded-3xl space-y-4 shadow-lg">
            <h3 className="font-bold text-sm text-zinc-800 dark:text-white flex items-center gap-1.5 select-none text-left">
              <FolderPlus className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-pulse" />
              New Collection
            </h3>
            <div className="text-left">
              <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-widest pl-1 mb-1">Collection Name</label>
              <input
                type="text"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="e.g. #Simulation Logs"
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 dark:text-white outline-hidden focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all shadow-xs"
                required
              />
            </div>
            <div className="text-left">
              <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-widest pl-1 mb-1">Description (Optional)</label>
              <input
                type="text"
                value={newColDesc}
                onChange={(e) => setNewColDesc(e.target.value)}
                placeholder="e.g. ROS2 topic parameters"
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-zinc-900 dark:text-white outline-hidden focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all shadow-xs"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 hover:scale-[1.01] active:scale-[0.99] text-white text-xs font-bold uppercase tracking-wider rounded-xl py-2.5 transition-all cursor-pointer shadow-md shadow-indigo-500/10"
            >
              Add Collection
            </button>
          </form>

          {/* Collections List */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-black text-zinc-455 dark:text-zinc-500 uppercase tracking-widest px-2 select-none text-left">
              Active Collections
            </h4>
            {loading && <p className="text-xs text-zinc-400 dark:text-zinc-500">Retrieving system index...</p>}
            {!loading && collections.length === 0 && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 italic px-2 text-left">No collections indexed in workspace.</p>
            )}
            <div className="space-y-2">
              {collections.map((col) => (
                <div
                  key={col.id}
                  onClick={() => setActiveCol(col)}
                  className={`group p-4 border rounded-2xl flex items-center justify-between cursor-pointer transition-all ${
                    activeCol?.id === col.id
                      ? 'border-indigo-500 bg-indigo-550/5 dark:bg-indigo-500/10 shadow-lg'
                      : 'border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-900/10 hover:bg-zinc-100 dark:hover:bg-zinc-900/30 hover:border-zinc-300 dark:hover:border-zinc-800'
                  }`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <div className="font-bold text-sm text-zinc-900 dark:text-white truncate">
                      {col.name}
                    </div>
                    {col.description && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-500 truncate mt-0.5">{col.description}</p>
                    )}
                    <span className="inline-block mt-2 px-2 py-0.5 text-[9px] font-bold bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 text-indigo-600 dark:text-indigo-400 rounded-md uppercase tracking-wider">
                      {col.doc_count} files
                    </span>
                  </div>
                  {confirmDeleteColId === col.id ? (
                    <div className="flex items-center gap-1.5 animate-in fade-in duration-150 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleDeleteCollection(col.id, e)}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] uppercase px-2 py-1 rounded-lg transition-colors cursor-pointer"
                        title="Permanently erase this collection"
                      >
                        Wipe
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteColId(null); }}
                        className="bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-350 font-bold text-[10px] px-2 py-1 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-750 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteColId(col.id); }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-400 dark:text-zinc-550 hover:text-rose-600 dark:hover:text-rose-500 p-2 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-900 transition-all cursor-pointer border border-zinc-200 dark:border-transparent hover:border-zinc-300 dark:hover:border-zinc-800 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Documents Ingestion details */}
        <div className="lg:col-span-2 space-y-6">
          {activeCol ? (
            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className="relative border border-zinc-250 dark:border-zinc-900 rounded-3xl p-6 bg-white dark:bg-zinc-900/10 backdrop-blur-md shadow-lg animate-in fade-in duration-200 transition-colors duration-300"
            >
              {/* Drag and Drop Overlay */}
              {dragActive && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-indigo-500/10 dark:bg-indigo-500/20 border-2 border-dashed border-indigo-500 rounded-3xl backdrop-blur-sm pointer-events-none animate-in fade-in duration-150">
                  <Upload className="w-10 h-10 text-indigo-500 animate-bounce mb-3" />
                  <p className="text-sm font-black text-indigo-600 dark:text-indigo-300">Drop files or folders here</p>
                  <p className="text-[11px] font-bold text-zinc-500 mt-1">Release to index into "{activeCol.name}"</p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-200 dark:border-zinc-900 pb-5 mb-5 gap-4">
                <div className="text-left">
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{activeCol.name}</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-550 mt-0.5">{activeCol.description || 'No description provided'}</p>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  {/* Upload Files Button */}
                  <label className={`relative flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer bg-gradient-to-tr from-indigo-650 to-purple-650 hover:from-indigo-600 hover:to-purple-600 text-white transition-all shadow-md shadow-indigo-500/10 hover:scale-[1.01] active:scale-[0.99] ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Upload className="w-3.5 h-3.5" />
                    Upload Files
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={handleFileUpload}
                      accept=".pdf,.csv,.xlsx,.docx,.pptx,.txt,.md,.xml,.py,.cpp,.h,.json,.yaml,.yml,.log,.html,.htm,.mp3,.wav,.m4a,.ogg,.flac,.png,.jpg,.jpeg,.webp,.bmp,.tiff"
                      disabled={uploading}
                    />
                  </label>

                  {/* Upload Folder Button */}
                  <label className={`relative flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-all shadow-md hover:scale-[1.01] active:scale-[0.99] ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <FolderPlus className="w-3.5 h-3.5" />
                    Upload Folder
                    <input
                      type="file"
                      className="hidden"
                      webkitdirectory=""
                      directory=""
                      onChange={handleFileUpload}
                      disabled={uploading}
                    />
                  </label>
                </div>
              </div>

              {uploading && (
                <div className="p-4 mb-6 bg-indigo-500/10 border border-indigo-500/20 dark:border-indigo-500/25 text-indigo-700 dark:text-indigo-400 text-xs rounded-2xl flex items-center gap-3 animate-pulse text-left font-semibold">
                  <span className="w-4.5 h-4.5 border-2 border-indigo-500 dark:border-indigo-400/20 border-t-indigo-600 dark:border-t-transparent rounded-full animate-spin shrink-0" />
                  <div className="flex-1">
                    <p className="font-bold">{uploadProgress || 'Processing document...'}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5 leading-normal">Running text splitting (1000 size), compiling local vector embeddings, and updating Chroma + SQLite database structures...</p>
                  </div>
                </div>
              )}

              {/* Documents List */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-zinc-450 dark:text-zinc-500 uppercase tracking-widest text-left select-none">
                  Indexed Core Data Sources
                </h4>
                {documents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 border border-dashed border-zinc-200 dark:border-zinc-850 rounded-3xl text-center bg-zinc-50/50 dark:bg-zinc-950/40 select-none">
                    <Database className="w-10 h-10 text-zinc-400 dark:text-zinc-650 mb-3 animate-pulse" />
                    <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">Workspace collection is empty</p>
                    <p className="text-xs text-zinc-500 mt-1 max-w-xs leading-relaxed">
                      Upload PDF, Excel, Word, PowerPoint, CSV, TXT, JSON, Markdown, or source files to create shared semantic indexes.
                    </p>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-900 rounded-2xl divide-y divide-zinc-200 dark:divide-zinc-900 overflow-hidden shadow-xs">
                    {documents.map((doc) => (
                      <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors">
                        <div className="flex items-center gap-3.5 min-w-0 text-left">
                          <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 flex items-center justify-center text-indigo-650 dark:text-indigo-400 shrink-0 shadow-inner">
                            <FileText className="w-4.5 h-4.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-zinc-800 dark:text-zinc-200 truncate">
                              {doc.name}
                            </p>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-500 font-bold flex items-center gap-2 mt-1">
                              <span className="text-indigo-600 dark:text-indigo-400 font-mono">{doc.file_type.toUpperCase()}</span>
                              <span className="w-1 h-1 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                              <span>{formatSize(doc.file_size)}</span>
                              <span className="w-1 h-1 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                              <span>{new Date(doc.uploaded_at).toLocaleDateString()}</span>
                            </p>
                          </div>
                        </div>
                        {confirmDeleteDocId === doc.id ? (
                          <div className="flex items-center gap-1.5 animate-in fade-in duration-150 shrink-0">
                            <button
                              onClick={() => handleDeleteDoc(doc.id)}
                              className="bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] uppercase px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setConfirmDeleteDocId(null)}
                              className="bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-350 font-bold text-[10px] px-2.5 py-1.5 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-750 transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteDocId(doc.id)}
                            className="text-zinc-400 dark:text-zinc-550 hover:text-rose-600 dark:hover:text-rose-500 p-2 border border-zinc-200 dark:border-transparent hover:border-zinc-300 dark:hover:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl transition-all cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-12 border border-dashed border-zinc-200 dark:border-zinc-850 rounded-3xl text-center bg-white dark:bg-zinc-900/10 backdrop-blur-md h-[400px] select-none shadow-sm transition-colors duration-300">
              <ChevronRight className="w-12 h-12 text-zinc-400 dark:text-zinc-700 transform rotate-90 lg:rotate-0 mb-4" />
              <p className="text-sm font-bold text-zinc-700 dark:text-zinc-350">No collection selected</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 max-w-sm mt-1.5 leading-relaxed">
                Select a collection database from the sidebar checklist to inspect files, view size metrics, or trigger file uploads.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CollectionManager;
