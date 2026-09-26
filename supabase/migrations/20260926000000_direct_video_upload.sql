update storage.buckets
set public = false,
    file_size_limit = 104857600,
    allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime']
where id = 'videos';
