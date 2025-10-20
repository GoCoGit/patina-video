import { useState, useRef, useEffect } from 'react'
import './App.css'
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

function App() {
  const [loaded, setLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inputVideo, setInputVideo] = useState(null);
  const [outputVideo, setOutputVideo] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [iterations, setIterations] = useState(30);
  const [currentIteration, setCurrentIteration] = useState(0);
  const ffmpegRef = useRef(new FFmpeg());
  const messageRef = useRef(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);

  // 页面加载时自动执行FFmpeg加载
  useEffect(() => {
    setIsLoading(true);
    load();
  }, []); // 空依赖数组表示只在组件挂载时执行一次

  const load = async () => {
    // const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
    const ffmpeg = ffmpegRef.current;
    ffmpeg.on('log', ({ message }) => {
      messageRef.current.innerHTML = message;
      console.log(message);
    });
    // toBlobURL is used to bypass CORS issue, urls with the same
    // domain can be used directly.
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setLoaded(true);
    } catch (error) {
      console.error('FFmpeg加载失败:', error);
      messageRef.current.innerHTML = 'FFmpeg加载失败: ' + error.message;
    } finally {
      setIsLoading(false);
    }
  }

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setInputVideo(file);
      setOutputVideo(null);
      // Create preview URL for the uploaded video
      const videoUrl = URL.createObjectURL(file);
      if (videoRef.current) {
        videoRef.current.src = videoUrl;
      }
    }
  };

  const createPatinaEffect = async () => {
    if (!inputVideo) {
      alert('请先上传一个视频文件！');
      return;
    }

    setIsProcessing(true);
    setCurrentIteration(0);
    const ffmpeg = ffmpegRef.current;

    try {
      // Write input file to FFmpeg
      messageRef.current.innerHTML = '正在上传视频到FFmpeg...';
      await ffmpeg.writeFile('input.mp4', await fetchFile(inputVideo));

      // 先进行缩放处理以提高性能
      messageRef.current.innerHTML = '正在预处理视频（缩放）...';
      await ffmpeg.exec([
        '-i', 'input.mp4',
        '-vf', 'scale=trunc(iw*0.5/2)*2:trunc(ih*0.5/2)*2',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '30',
        'lowres.mp4'
      ]);

      let currentFile = 'lowres.mp4';

      // Iterative processing loop
      for (let i = 1; i <= iterations; i++) {
        setCurrentIteration(i);
        const outputFile = `iter${String(i).padStart(3, '0')}.mp4`;

        // Calculate degrading parameters based on iteration
        const crf = Math.min(20 + Math.floor(i / 3), 40); // Quality degradation
        let bitrate = Math.max(1200 - i * 8, 200); // Bitrate reduction

        // Scale reduction every 10 iterations
        let scaleFilter = 'scale=iw:ih';
        if (i % 10 === 0) {
          scaleFilter = 'scale=trunc(iw*0.9/2)*2:trunc(ih*0.9/2)*2';
        }

        // Random noise strength
        const noiseStrength = (i % 7) + 3;

        messageRef.current.innerHTML = `正在处理第 ${i}/${iterations} 次迭代...`;

        // Apply video filters: scale, format, contrast/brightness/saturation adjustments, noise
        await ffmpeg.exec([
          '-i', currentFile,
          '-vf', `${scaleFilter},format=yuv420p,eq=contrast=0.95:brightness=-0.01:saturation=0.95,noise=alls=${noiseStrength}:allf=t`,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-profile:v', 'baseline',
          '-level', '3.0',
          '-crf', crf.toString(),
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '48k',
          '-ar', '22050',
          '-movflags', '+faststart',
          '-f', 'mp4',
          outputFile
        ]);

        currentFile = outputFile;

        // Clean up previous iteration file (except input and lowres)
        if (i > 1 && currentFile !== 'input.mp4' && currentFile !== 'lowres.mp4') {
          try {
            await ffmpeg.deleteFile(`iter${String(i - 1).padStart(3, '0')}.mp4`);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }

      // Read the final output file
      messageRef.current.innerHTML = '正在读取最终输出文件...';
      const data = await ffmpeg.readFile(currentFile);

      // Create blob URL for the output video
      const outputBlob = new Blob([data.buffer], { type: 'video/mp4' });
      const outputUrl = URL.createObjectURL(outputBlob);

      setOutputVideo(outputUrl);
      messageRef.current.innerHTML = `包浆完成！共处理 ${iterations} 次迭代`;

    } catch (error) {
      console.error('包浆处理失败:', error);
      messageRef.current.innerHTML = '包浆处理失败: ' + error.message;
    } finally {
      setIsProcessing(false);
      setCurrentIteration(0);
    }
  };

  const resetVideo = () => {
    setInputVideo(null);
    setOutputVideo(null);
    setCurrentIteration(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (videoRef.current) {
      videoRef.current.src = '';
    }
  };

  return (
    <div className="app-container">
      <h1>清朝老片生成器</h1>

      {!loaded ? (
        <div className="load-container">
          {isLoading ? (
            <>
              <p>正在加载 FFmpeg 核心组件 (~31 MB)...</p>
              <p>请稍候，首次加载可能需要一些时间</p>
              <div className="loading-spinner"></div>
            </>
          ) : (
            <>
              <p>FFmpeg 加载失败</p>
              <p ref={messageRef} className="error-message"></p>
              <button onClick={() => { setIsLoading(true); load(); }}>重新加载</button>
            </>
          )}
        </div>
      ) : (
        <div className="converter-container">
          <div className="upload-section">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="video/*"
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current.click()}
              disabled={isProcessing}
            >
              选择视频文件
            </button>

            {inputVideo && (
              <div className="video-info">
                <p>视频大小: {(inputVideo.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            )}
          </div>

          {/* Iteration controls */}
          <div className="controls-section">
            <div className="iteration-control">
              <label htmlFor="iterations">迭代次数:</label>
              <input
                id="iterations"
                type="number"
                min="1"
                max="100"
                value={iterations}
                onChange={(e) => setIterations(parseInt(e.target.value))}
                disabled={isProcessing}
                className="iteration-input"
              />
            </div>
          </div>


          <div className="action-buttons">
            {inputVideo && (
              <button
                onClick={createPatinaEffect}
                disabled={isProcessing}
                className="convert-button"
              >
                {isProcessing ? `处理中... (${currentIteration}/${iterations})` : '开始处理'}
              </button>
            )}

            {(inputVideo || outputVideo) && (
              <button
                onClick={resetVideo}
                disabled={isProcessing}
                className="reset-button"
              >
                重置
              </button>
            )}
          </div>

          {/* Progress bar */}
          {isProcessing && (
            <div className="progress-section">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(currentIteration / iterations) * 100}%` }}
                ></div>
              </div>
              <p className="progress-text">
                进度: {currentIteration}/{iterations} ({Math.round((currentIteration / iterations) * 100)}%)
              </p>
            </div>
          )}

          {outputVideo && (
            <div className="output-section">
              <video
                src={outputVideo}
                controls
                style={{ maxWidth: '100%', maxHeight: '300px' }}
              />
              <br />
              <a
                href={outputVideo}
                download="patina_video.mp4"
                className="download-link"
              >
                下载视频
              </a>
            </div>
          )}

          <div className="status-section" style={{ visibility: isProcessing ? 'visible' : 'hidden' }}>
            <p ref={messageRef} className="status-message"></p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App
