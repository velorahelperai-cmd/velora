-- VEL-006A-FIX: align Storage bucket MIME list with app canonical types

update storage.buckets
set
  allowed_mime_types = array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ],
  file_size_limit = 10485760,
  public = false
where id = 'company-knowledge';
