export const fetchByIdQuery = `query ($id: Int ,$type: MediaType, $asHtml:Boolean = true) { 
  Media (id: $id, type:$type) { 
    id
    idMal
    title {
      romaji
      english
      native
      userPreferred
    }
    type
    format
    status
    isAdult
    countryOfOrigin
    seasonYear
    synonyms
    description(asHtml: $asHtml)
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
    season
    meanScore
    averageScore
    duration
    episodes
    coverImage {
      extraLarge
      large
      medium
      color
    }
    
    trailer {
      id
      site
      thumbnail
    }
  
    genres
    bannerImage
    studios {
        nodes {
          name
        }
    }
  }
}`;

export const topQuery = `query Query($page: Int, $perPage: Int, $type: MediaType, $format: MediaFormat, $status: MediaStatus, $isAdult: Boolean, $sort: [MediaSort]) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      perPage
      currentPage
      lastPage
      hasNextPage
    }
    media(type: $type, format: $format, status: $status, isAdult: $isAdult, sort: $sort) {
      id
      idMal
      title {
        romaji
        english
        native
        userPreferred
      }
      type
      format
      status
      episodes
      duration
      season
      genres
      studios {
        nodes {
          name
        }
     }
      description
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      trailer {
        id
        site
        thumbnail
      }
      bannerImage
      coverImage {
        extraLarge
        large
        medium
        color
      }
      averageScore
      meanScore
      
    }
    
  }
}`;

export const popularAnimeQuery = `query Query($page: Int, $perPage: Int, $type: MediaType, $format: MediaFormat, $isAdult: Boolean, $sort: [MediaSort]) {
  Page(page: $page, perPage: $perPage) {
  pageInfo {
      total
      perPage
      currentPage
      lastPage
      hasNextPage
    }
    media(type: $type, format: $format, isAdult: $isAdult, sort: $sort) {
      id
      idMal
      title {
        romaji
        english
        native
        userPreferred
      }
      type
      format
      status
      episodes
      duration
      season
      genres
      studios {
        nodes {
          name
        }
     }
      description
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      trailer {
        id
        site
        thumbnail
      }
      bannerImage
      coverImage {
        extraLarge
        large
        medium
        color
      }
      averageScore
      meanScore
    
    }
    
  }
}`;

export const seasonQuery = `query Query($page: Int, $perPage: Int, $type: MediaType, $format: MediaFormat, $isAdult: Boolean, $season: MediaSeason, $seasonYear: Int, $sort: [MediaSort]) {
  Page(page: $page, perPage: $perPage) {
   pageInfo {
      total
      perPage
      currentPage
      lastPage
      hasNextPage
    }
    media(type: $type, format: $format, isAdult: $isAdult, season: $season, seasonYear: $seasonYear, sort: $sort) {
      id
      idMal
      title {
        romaji
        english
        native
        userPreferred
      }
      type
      format
      status
      episodes
      duration
      season
      genres
      description
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      trailer {
        id
        site
        thumbnail
      }
       format
      bannerImage
      coverImage {
        extraLarge
        large
        medium
        color
      }
      averageScore
      meanScore
      studios {
        nodes {
          name
        }
      }
    }
  }
}`;

export const searchQuery = `query Query($page: Int, $perPage: Int, $search: String, $type: MediaType, $isAdult: Boolean) {
  Page(page: $page, perPage: $perPage) {pageInfo {
      total
      perPage
      currentPage
      lastPage
      hasNextPage
    }
    media(search: $search, type: $type, isAdult: $isAdult) {
      id
      idMal
      episodes
      duration
      season
      title {
        romaji
        english
        native
        userPreferred
      }
      type
      format
      genres
      status
      description
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      trailer {
        id
        site
        thumbnail
      }
      bannerImage
      coverImage {
        extraLarge
        large
        medium
        color
      } 
      format
      averageScore
      meanScore
      studios {
        nodes {
          name
        }
      }
    }
    
  }
}`;

export const characterQuery = `query Media($mediaId: Int, $sort: [CharacterSort], $voiceActorsSort2: [StaffSort]) {
  Media(id: $mediaId) {
    id
    idMal
    title {
      romaji
      english
      native
    }
    characters(sort: $sort) {
      edges {
        role
        node {
          id
          name {
            full
          }
          image {
            large
            medium
          }
        }
        voiceActors(sort: $voiceActorsSort2) {
          name {
            full
          }
          image {
            large
            medium
          }
          languageV2
        }
      }
    }
  }
}`;

export const mediaTrendQuery = `query Query($page: Int, $perPage: Int, $type: MediaType, $format: MediaFormat) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      perPage
      currentPage
      lastPage
      hasNextPage
    }
    media(type:$type,format: $format, sort:TRENDING_DESC, isAdult: false) {
      id
      idMal
      title {
        romaji
        english
        native
        userPreferred
      }
      studios {
        nodes {
          name
        }
      }
      status
      description
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      season
      episodes 
      averageScore
      meanScore
      popularity
      bannerImage
      coverImage {
        extraLarge
        large
        medium
        color
      }
      format
      genres
    }
  }
}`;
export const relatedQuery = `
query Media($mediaId: Int!, $type: MediaType!) {
  Media(id: $mediaId, type: $type) {
    id
    idMal
    title {
      romaji
      english
      native
      userPreferred
    }
    countryOfOrigin
    seasonYear
    synonyms
    type
    bannerImage
    coverImage {
      extraLarge
      large
      medium
      color
    }
    averageScore
    meanScore
    format
    relations {
    edges {
    relationType(version: 3)  
    node {
      id
      idMal
      title {
        romaji
        english
        native
        userPreferred
      }
      countryOfOrigin
      seasonYear
      synonyms
      type
      format
      bannerImage
      coverImage {
        extraLarge
        large
        medium
        color
      }
      averageScore
      meanScore
    }
  }
}
  }
}`;

export const mediaAiringSchedule = `query AiringSchedule($mediaId: Int) {
  AiringSchedule(mediaId: $mediaId) {
    media {
      bannerImage
      averageScore
      coverImage {
        color
        extraLarge
        large
        medium
      }
       startDate {
        year
        month
        day
      }

      endDate {
        day
        month
        year
      }
      format
      idMal
      nextAiringEpisode {
        airingAt
        episode
        id
        timeUntilAiring
      }
      duration
      title {
        english
        native
        romaji
        userPreferred
      }
      id
      status
      popularity
    }
  }
}`;

// take note
// {
//   "mediaId": 178090
// }

export const airingSchedule = `query Page($page: Int, $perPage: Int, $notYetAired: Boolean) {
  Page(page: $page, perPage: $perPage) {
    airingSchedules(notYetAired: $notYetAired) {
      media {
        bannerImage
        id
        idMal
         title {
            romaji
            english
            native
            userPreferred
          }
        averageScore
        coverImage {
          color
          extraLarge
          large
          medium
        }
        description
        duration
        type
        status
        season
        startDate {
          day
          month
          year
        }
        endDate {
          day
          month
          year
        }
        popularity
        format
        genres
        nextAiringEpisode {
          episode
          id
          airingAt
        }
        episodes
        meanScore
        countryOfOrigin
      }
    }
    pageInfo {
      currentPage
      hasNextPage
     
    }
  }
}`;
export const fetchAiringByDate = `query Page($page: Int, $perPage: Int, $airingAtLesser: Int, $airingAtGreater: Int) {
  Page(page: $page, perPage: $perPage) {
    airingSchedules(airingAt_lesser: $airingAtLesser, airingAt_greater: $airingAtGreater) {
      media {
        bannerImage
        id
        idMal
         title {
            romaji
            english
            native
            userPreferred
          }
        averageScore
        coverImage {
          color
          extraLarge
          large
          medium
        }
        description
        duration
        type
        status
        season
        startDate {
          day
          month
          year
        }
        endDate {
          day
          month
          year
        }
        popularity
        format
        genres
        nextAiringEpisode {
          episode
          id
          airingAt
        }
        episodes
        meanScore
        countryOfOrigin
      }
    }
    pageInfo {
      currentPage
      hasNextPage
      lastPage
      perPage
    }
  }
}`;

export const searchQueryWithSort = `query Query($page: Int, $perPage: Int, $search: String, $type: MediaType, $isAdult: Boolean) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      perPage
      currentPage
      lastPage
      hasNextPage
    }
    media(search: $search, type: $type, isAdult: $isAdult, sort: SEARCH_MATCH) {
      id
      idMal
      episodes
      duration
      season
      title {
        romaji
        english
        native
        userPreferred
      }
      type
      format
      genres
      status
      description
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      trailer {
        id
        site
        thumbnail
      }
      bannerImage
      coverImage {
        extraLarge
        large
        medium
        color
      } 
      averageScore
      meanScore
      studios {
        nodes {
          name
        }
      }
    }
  }
}`;

export const singleResultQuery = `query Query($search: String, $type: MediaType, $isAdult: Boolean) {
  Media(search: $search, type: $type, isAdult: $isAdult, sort: SEARCH_MATCH) {
    id
    idMal
    episodes
    duration
    season
    title {
      romaji
      english
      native
      userPreferred
    }
    type
    format
    genres
    status
    description
    startDate {
      year
      month
      day
    }
    endDate {
      year
      month
      day
    }
    trailer {
      id
      site
      thumbnail
    }
    bannerImage
    coverImage {
      extraLarge
      large
      medium
      color
    } 
    averageScore
    meanScore
    studios {
      nodes {
        name
      }
    }
  }
}`;
